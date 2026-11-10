# Automated browser compatibility smoke tests

These are **emulated browser checks**, not release certification on actual
iOS, Android or macOS Safari hardware. The normal CI suite retains Chromium
FFmpeg-verified media conversions.

The dedicated compatibility workflow runs Playwright 1.65 on:

| Environment | Browser/project | What is represented |
| --- | --- | --- |
| Ubuntu Linux | Firefox desktop | Playwright's patched recent Firefox, Linux codecs |
| Ubuntu Linux | Chromium / Pixel 5 | Android-like viewport, touch and UA; not real Android codecs |
| macOS | WebKit desktop | Safari's engine, not the branded Safari app |
| macOS | WebKit / iPhone 13 | iPhone-like viewport, touch and UA; **not real iOS** |

Each profile tests a small synthetic PCM/WAV input in the on-device converter,
checking capability gating and explicit unsupported states. When WAV is offered,
the suite demands a real downloaded RIFF/WAVE file. It also checks the batch
import UI for viewport overflow, pasted File handling, crash-free operation
and absence of media POST/PUT requests. Capability snapshots are recorded in
the test report as JSON, with traces/screenshots retained on failure.

Run locally after a production build:

```sh
pnpm build
pnpm exec playwright install chromium firefox webkit
pnpm exec playwright test -c playwright.compat.config.ts
```

Use `COMPAT_BROWSER=firefox`, `chromium` or `webkit` to select an engine.
The existing `pnpm test:browser` command intentionally remains the
Chromium real-codec/FFprobe suite.

**Limitations:** Playwright's patched Firefox/WebKit browser builds are not
identical to shipped branded browsers. Media codecs, GPU acceleration, browser
storage quotas, OS clipboard file exposure and memory pressure vary by device.
Green simulated tests cannot establish video conversion support or
performance on physical iPhones/Android phones. Native Safari, Firefox device
coverage and mobile hardware checks remain a separate release gate.
