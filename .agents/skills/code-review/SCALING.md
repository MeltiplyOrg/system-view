# Scaling and Performance Review Guide

Reference for the **Optimization** axis of `code-review`. This is a checklist of mechanisms, not a mandate to apply every pattern. Every finding must name a plausible bottleneck, the expected impact, the smallest fix, and the trade-off. Measure first; an optimization without a measurement is a hypothesis.

## Measure first

- Establish a baseline before changing code: p50/p95/p99 latency, throughput, error rate, CPU, memory, I/O, database queries per request, queue depth, and cache hit rate.
- Frame the baseline with the four golden signals: latency (including p99), traffic, errors, and saturation. Together they show whether the bottleneck is demand, failure, or capacity.
- Reproduce with a workload that resembles production: data volume, cardinality, concurrency, and read/write mix. A toy dataset can hide a bad query plan or an N+1.
- Profile before rewriting. Find the dominant cost, then check whether the change can move it. Amdahl's law caps the win at the share of time the bottleneck consumes.
- Optimize the tail, not only the average. Fan-out amplifies p99: a request that calls 100 backends at p99 = 10 ms has an end-to-end p99 closer to 140 ms (Dean & Barroso, *The Tail at Scale*).
- Record the before/after measurement and add a regression budget where the project supports it. "Faster" without a number is not a finding.

## Review workflow

1. **Name the operation and its scale.** A bulk endpoint with 1,000 items is a different problem from a single-record read. State expected QPS, payload size, fan-out, and data volume.
2. **Count the I/O.** Queries, remote calls, serialization passes, bytes over the wire, and round trips per request.
3. **Find multiplicative work.** Per-item queries, per-item remote calls, nested loops over collections, and fan-out are the usual scaling cliffs.
4. **Check the capacity limits.** Database connections, pool sizes, queue depth, memory, open sockets, file descriptors, and concurrency.
5. **Propose the smallest approach-level change.** Prefer batching, joins, indexes, caching, pagination, or queueing over micro-optimizations.
6. **State the trade-off and verification.** Every optimization buys something by spending something else: consistency, freshness, memory, write cost, or complexity.
7. **Rank by impact × confidence ÷ effort.** Separate proven findings from ones that need measurement.

## 1. Data access

### N+1 queries

**Signal:** one query for a collection, then one additional query per item (ORM lazy loading, resolver-per-item, `await` inside a loop, a service call per row).

```text
orders = SELECT * FROM orders WHERE ...
for each order:
  SELECT * FROM customers WHERE id = order.customer_id   -- N extra queries
```

**Fix:** fetch the related rows in one set-based query and join them in memory; use a join/eager load; or use a request-scoped batch loader (DataLoader pattern) that collects keys and executes one `WHERE id IN (...)`.

```sql
SELECT * FROM customers WHERE id IN (<customer ids>);
```

**Watch out:** chunk large `IN` lists to stay under database parameter and packet limits; keep batch-loader caches request-scoped; `Promise.all(ids.map(load))` only batches if the loader defers dispatch to the next tick, not if each load is awaited first.

### Serial I/O that could be concurrent

**Signal:** independent remote calls, file reads, or queries awaited one after another.

**Fix:** issue independent work concurrently with a bounded concurrency limit. Do not parallelize dependent writes, ordered events, or operations that share a transaction unless ordering and idempotency are guaranteed.

**Watch out:** unbounded `Promise.all` over user-controlled input is a denial-of-service vector. Cap concurrency and batch size.

### Batching writes

**Signal:** one `INSERT`/`UPDATE`/`DELETE` per item in a bulk request; one transaction per row; one remote call per record.

**Fix:** multi-row insert or bulk upsert, `COPY` for large loads, batched updates, or a queue that writes in batches. Size the batch to the database's parameter, lock, and transaction limits.

**Watch out:** one giant transaction holds locks and bloats the write-ahead log. Chunk the work and make retries idempotent.

### Indexes and query plans

**Signal:** sequential scans over large tables, filters that remove most rows, missing indexes on join/filter/sort columns, or a query that is fast on 1,000 rows and slow on 10 million.

**Fix:** add or adjust the index for the actual predicate and ordering; use a covering index when it avoids heap fetches; run `EXPLAIN (ANALYZE, BUFFERS)` on representative data.

**Watch out:** every index taxes writes and storage. Do not index every column, and verify the planner uses the index at production cardinality.

### Pagination and projections

**Signal:** unbounded `SELECT *`, returning whole collections, deep `OFFSET` pagination, or loading a full result set to slice it in memory.

**Fix:** select only needed fields; paginate with a bounded page size and an opaque cursor/keyset token rather than a large offset; stream large responses instead of buffering them.

**Watch out:** offset pagination gets slower and less stable as the offset grows. Cursor pagination needs a stable, unique ordering key.

### Connections and transactions

**Signal:** a new database connection per request, pool exhaustion under load, long transactions, or locks held across network calls.

**Fix:** reuse a bounded connection pool; size the pool to the database's capacity, not the application's maximum concurrency; keep transactions short; use optimistic concurrency where appropriate.

**Watch out:** a pool that is too large can overwhelm the database. Transaction pooling (for example PgBouncer) changes which session features are safe.

### Read scaling and precomputation

**Signal:** read-heavy endpoints repeatedly computing the same aggregate or joining the same large tables.

**Fix:** cache-aside for stale-tolerant reads, materialized views or read models for expensive aggregates, read replicas for read-heavy traffic, or CQRS where read and write shapes genuinely differ.

**Watch out:** replicas and materialized views are eventually consistent. Define the acceptable staleness and the refresh/invalidation path.

### Partitioning and sharding

**Signal:** a single primary is the proven write or storage bottleneck after indexing, batching, and query tuning; or one hot tenant/key dominates traffic.

**Fix:** partition by a high-cardinality key, use an index table for alternate lookup keys, or shard as a deliberate last resort.

**Watch out:** sharding is permanent operational complexity: cross-shard joins, rebalancing, transactions, and failure recovery all get harder. Fix the query and schema first.

## 2. Caching

- **Cache-aside:** read the cache, fall back to the source on a miss, populate with a TTL, and invalidate or version on writes. Cache data that is expensive to produce and read often.
- **Stampede protection:** when a hot key expires, many requests can hit the source at once. Use single-flight/mutex, probabilistic early refresh, or `stale-while-revalidate` so one caller refreshes while others get a usable stale value.
- **Keys and scope:** include tenant, user, locale, and schema version where they change the result. Never put per-user secrets in a shared cache.
- **Negative caching:** cache "not found" briefly to protect the source from repeated misses, but keep the TTL short.
- **Hit rate:** instrument it. A cache with a low hit rate adds a network hop and a consistency problem without buying much.
- **HTTP and CDN:** use `Cache-Control` with `public`/`private`, `max-age`, `s-maxage`, and `stale-while-revalidate`; use ETags for revalidation. Hash immutable asset names and cache them for a long time.
- **In-process vs distributed:** in-process caches are fast but per-instance and hard to invalidate consistently; distributed caches add a hop but share state.
- **Caching is not throttling:** a cache lowers average load; it does not bound peak load. A cold or expired key still sends traffic to the origin.

## 3. API and payload

- **Return only what the caller needs:** field selection/partial responses, projections, and sparse payloads reduce serialization, bandwidth, and memory.
- **Paginate every collection at the outset:** bounded default and maximum page size, opaque cursor tokens, and a stable sort. Adding pagination later is behaviourally breaking.
- **Compress:** gzip/brotli for text-heavy responses; tune the compression level against CPU cost. Do not compress already-compressed media.
- **Stream:** stream large downloads and long responses instead of building the whole payload in memory.
- **Batch endpoints:** accept arrays for bulk operations, cap the batch size, and return per-item results so partial failures are visible.
- **Async request-reply:** move long-running work to a queue and return a job id or accepted status. Provide idempotency keys for retried writes.
- **Reduce round trips:** coalesce requests, prefetch what the next step certainly needs, or aggregate at a gateway. Avoid a chatty client that needs 30 calls to render one screen.

## 4. Concurrency, queues, and overload

- **Bound everything:** concurrency, queue length, batch size, in-flight requests, and retries. Unbounded work converts a traffic spike into memory, socket, or database exhaustion.
- **Backpressure:** when a queue or pool is full, reject early with `429`/`503` and `Retry-After` rather than letting latency and memory grow.
- **Queues for spikes and slow work:** queue-based load leveling decouples intake from processing; competing consumers scale out; monitor queue depth and age.
- **Timeouts:** every network call has a deadline. A missing timeout turns a slow dependency into a thread/connection leak.
- **Retries:** exponential backoff with jitter, a retry budget, and idempotent operations. Retries without a budget amplify overload into a retry storm.
- **Circuit breakers and bulkheads:** stop calling a failing dependency and isolate pools so one dependency cannot exhaust all capacity.
- **Load shedding:** when approaching overload, reject a growing fraction of low-value or retryable work early; serve degraded results where acceptable.
- **Rate limits:** per principal, tenant, or operation. Protect the resource that saturates first, not just requests per second.
- **Tail latency:** reduce fan-out, set deadlines, and consider hedged requests only for idempotent reads where the extra work is acceptable.

## 5. Architecture and distribution

- **Stateless services:** keep request state out of process memory so instances can scale horizontally; sticky sessions are a scaling smell unless the state is genuinely session-scoped.
- **Read/write separation:** CQRS, read models, and materialized views help when read and write shapes or volumes diverge. They cost consistency and projection maintenance.
- **Event-driven side effects:** move notifications, indexing, and other slow side effects off the request path; use an outbox or transactional log to publish reliably.
- **Precompute deliberately:** denormalize or precompute for a known query, with a named owner and invalidation strategy. Do not denormalize before measuring.
- **Avoid a distributed monolith:** chatty service-to-service calls multiply latency and failure modes. Aggregate or colocate work that changes together.
- **Multi-region:** serve reads near users and replicate writes, but define consistency, failover, and data-residency trade-offs.

## 6. Runtime and resources

- **Memory:** unbounded caches, whole-file reads, large result sets, and leaking listeners cause GC pressure and OOM kills. Stream, chunk, and cap.
- **CPU:** repeated parsing/serialization, hot loops, catastrophic regex backtracking, and expensive compression levels show up in profiles. Fix the measured hot path.
- **Network:** reuse connections (keep-alive), avoid per-request TLS/DNS overhead, reduce payload size, and batch chatty calls.
- **Pools and workers:** size thread, connection, and worker pools to the downstream capacity. A larger pool can reduce throughput by increasing contention.
- **Observability:** add metrics or tracing around the changed path so the improvement is visible and regressions are caught.

## 7. False optimizations

- Micro-optimizing code that is not on the hot path, or optimizing before profiling.
- Caching mutable data without an invalidation or versioning strategy.
- Replacing N+1 with unbounded `Promise.all`, which trades query count for connection exhaustion.
- Adding an index for every filter without measuring write cost and planner behaviour.
- Denormalizing or sharding before trying indexes, batching, and query rewrites.
- Hiding an N+1 behind a cache so it reappears on every cold start or expiry.
- Batching into one giant transaction that holds locks and increases retry cost.
- Retrying aggressively without backoff, jitter, or a retry budget.
- Optimizing p50 while the SLO is about p99.
- Treating a benchmark on a tiny dataset as proof of production behaviour.

## 8. Finding format

```text
### Finding: <short title>
- Where: `path/to/file.ts:123`
- Mechanism: <why this gets worse with scale>
- Evidence: <call path/query count/EXPLAIN/profile> or "needs measurement"
- Fix: <smallest approach-level change>
- Impact: <expected effect and who feels it>
- Trade-off: <consistency/complexity/memory/write cost>
- Verification: <query count, EXPLAIN ANALYZE, profile, load test, p99>
- Confidence: High | Medium | Speculative
```

Rank findings by impact and confidence. A speculative but high-impact risk is worth reporting as such; a low-impact micro-optimization is not.

## Sources

- PostgreSQL 18: [Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html) and [Performance Tips](https://www.postgresql.org/docs/current/performance-tips.html)
- PgBouncer: [Features and pooling modes](https://www.pgbouncer.org/features.html)
- Apollo GraphQL: [Handling the N+1 problem](https://www.apollographql.com/docs/graphos/schema-design/guides/handling-n-plus-one)
- graphql-js: [Solving the N+1 problem with DataLoader](https://www.graphql-js.org/docs/n1-dataloader)
- Azure Architecture Center: [Cache-Aside](https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside), [Materialized View](https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view), [Index Table](https://learn.microsoft.com/en-us/azure/architecture/patterns/index-table), [Queue-Based Load Leveling](https://learn.microsoft.com/en-us/azure/architecture/patterns/queue-based-load-leveling), [Sharding](https://learn.microsoft.com/en-us/azure/architecture/patterns/sharding), [Throttling](https://learn.microsoft.com/en-us/azure/architecture/patterns/throttling), [CQRS](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)
- AWS Well-Architected: [Performance Efficiency Pillar](https://docs.aws.amazon.com/wellarchitected/latest/performance-efficiency-pillar/welcome.html)
- AWS Builders Library: [Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)
- Google SRE: [Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/), [Handling Overload](https://sre.google/sre-book/handling-overload/), and [Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/)
- Dean & Barroso: [The Tail at Scale](https://cacm.acm.org/research/the-tail-at-scale/)
- MDN: [Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control)
- Redis: [Cache-aside](https://redis.io/docs/latest/develop/use-cases/cache-aside)
- Google AIP-158: [Pagination](https://google.aip.dev/158)
