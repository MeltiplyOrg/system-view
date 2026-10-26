import { CDN_MARKS } from "./cdn-provider-marks";

/** Trusted Simple Icons artwork; inner brand fills survive tooltip/root styling. AWS/Cloudflare reuse existing marks. */
export const MEDIA_MARKS: Readonly<Record<string, string>> = {
  // https://cdn.simpleicons.org/rabbitmq
  rabbitmq:
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g fill="#FF6600"><path d="M23.035 9.601h-7.677a.956.956 0 01-.962-.962V.962a.956.956 0 00-.962-.956H10.56a.956.956 0 00-.962.956V8.64a.956.956 0 01-.962.962H5.762a.956.956 0 01-.961-.962V.962A.956.956 0 003.839 0H.959a.956.956 0 00-.956.962v22.076A.956.956 0 00.965 24h22.07a.956.956 0 00.962-.962V10.58a.956.956 0 00-.962-.98zm-3.86 8.152a1.437 1.437 0 01-1.437 1.443h-1.924a1.437 1.437 0 01-1.436-1.443v-1.917a1.437 1.437 0 011.436-1.443h1.924a1.437 1.437 0 011.437 1.443z"/></g></svg>',
  // https://cdn.simpleicons.org/natsdotio
  "nats-jetstream":
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g fill="#27AAE1"><path d="M12.004 0H.404v18.807h9.938l1.714 1.602v-.026L15.966 24v-5.193h7.63V0H12.003zm7.578 14.45H15.38L6.898 6.519v7.93H4.116V4.376h4.349l8.344 7.784V4.375h2.773V14.45z"/></g></svg>',
  // https://cdn.simpleicons.org/ffmpeg
  ffmpeg:
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g fill="#007808"><path d="M21.72 17.91V6.5l-.53-.49L9.05 18.52l-1.29-.06L24 1.53l-.33-.95-11.93 1-5.75 6.6v-.23l4.7-5.39-1.38-.77-9.11.77v2.85l1.91.46v.01l.19-.01-.56.66v10.6c.609-.126 1.22-.241 1.83-.36L14.12 5.22l.83-.04L0 21.44l9.67.82 1.35-.77 6.82-6.74v2.15l-5.72 5.57 11.26.95.35-.94v-3.16l-3.29-.18c.434-.403.858-.816 1.28-1.23z"/></g></svg>',
  "amazon-sqs": CDN_MARKS.cloudfront,
  "amazon-s3": CDN_MARKS.cloudfront,
  "cloudflare-r2": CDN_MARKS.cloudflare,
};
