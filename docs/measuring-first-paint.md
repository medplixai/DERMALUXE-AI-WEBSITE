# Measuring first paint

The commit before this one claimed deferring `analytics.js` saved 148–244ms.
That number was wrong, and the way it was wrong is worth keeping.

The test loaded the live page twice, and for one of the two arms it used
puppeteer's request interception to rewrite the HTML — fetch the document in
Node, change the one attribute, hand it back. CDP's
`Network.emulateNetworkConditions` throttles **the browser's** requests. A
`fetch()` in the Node process is not one of them, so the rewritten arm got its
HTML off an unthrottled connection while the other arm waited on a 400kbps
line. Whichever arm was intercepted won.

It looked convincing because it was run twice, once in each direction — and
both times the intercepted arm came out ahead, which is exactly the shape a
real effect does *not* have.

## How to do it instead

Serve the real files over a local server, throttle the browser, and change the
file on disk between runs. Both arms then travel the same road.

- **Alternate the arms** run by run rather than all of A then all of B, so a
  machine that gets busier partway through slows both the same way.
- **Disable the cache** (`Network.setCacheDisabled`), or the second arm is
  measuring a warm cache.
- **Take the middle of several runs**, never one number: a first run on a cold
  connection is routinely four times the rest.
- **Watch the spread.** Seven runs each landed within 20ms of one another
  above. A measurement whose arms overlap is not a measurement.

Absolute numbers off a local server are not what the site does — there is no
CDN and no compression, so everything is slower. The difference between the
two arms is the finding; the absolute figure is not.

## What the honest run said

On a 400kbps line with 400ms of latency, seven runs each:

| page | script blocking | script deferred | difference |
|---|---|---|---|
| `/` | 10,280ms | 8,300ms | **1,980ms sooner** |
| `/acne-treatment-eluru.html` | 5,544ms | 3,708ms | **1,836ms sooner** |

`tools/perf/first-paint.js` is that test.
