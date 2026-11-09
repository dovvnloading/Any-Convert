# Any-Convert — Experience & Visual Design Specification

> **Status:** design direction and interaction contract, not implemented. Reviewed 2026-11-09. [Project Map](../PROJECT_MAP.md) · [Architecture](ARCHITECTURE.md)

## Creative direction: the quiet instrument

**Implementation note (M0):** the initial workspace UI experiments with a lime
highlight rather than the cobalt token proposed below. Neither palette is
finalized until M1 visual review, accessibility contrast testing, and real
device evaluation; the architecture/interaction requirements remain binding.

Any-Convert should look and behave like a precision creative utility: intentional, calm, exceptionally legible. More like an editor's trusted tool than a conversion website. The visual identity is editorial restraint + a cinematic media viewport + engineered interaction detail.

**What it must not be:** oversized gradients, glass tiles, generic hero blobs, dark-purple SaaS templates, dozens of feature cards, unearned animations, tiny text, or an upload page that becomes a totally different UI after a file arrives.

**Personality:** confident, honest, technical without being intimidating, spacious without wasting screen real estate.

### Working visual system (adjust with real contrast tests)

| Token | Initial value | Role |
| --- | --- | --- |
| `surface.canvas` | `#F6F5F2` | Warm neutral, most app background |
| `surface.paper` | `#FFFFFF` | Primary elevated settings surface |
| `surface.media` | `#0C0E12` | Film/preview stage |
| `text.primary` | `#15181C` | Titles and actions |
| `text.secondary` | `#5A626B` | Metadata and secondary text |
| `border.quiet` | `#DDE0DE` | Dividers and input outlines |
| `accent.action` | `#315EF7` | Conversion CTA, selected states and focus; one intentional accent |
| `accent.muted` | `#ECF0FF` | Subtle active backgrounds |
| `state.success` | `#146F4D` | Confirmation text/accessible state |
| `state.error` | `#AD3136` | Error text + icon, not color-only signaling |

These are starting tokens, **not proof of WCAG contrast**; measure all text and focus pairings before shipping. A dark appearance can be added after the light appearance is impeccable; media stage remains black in both.

- **Type:** an expressive but disciplined grotesk for display (evaluate Instrument Sans / Geist), readable UI sans for body, compact mono (IBM Plex Mono or equivalent) only for technical values. Check distribution licenses. Avoid 4+ unrelated fonts.
- **Scale:** 12/13 for supporting annotations only; 14–16 body and controls; 20–24 section; 36–48 limited zero-state display. Never set essential labels below 14px.
- **Spacing:** 4px base with 8/12/16/24/32/48/64/80 increments. Large blank space is allowed only when it emphasizes the next task.
- **Radius:** 8px controls, 12px panels, 16px preview; avoid super-rounded pill overload.
- **Elevation:** primarily strokes and layer contrast; one soft shadow for popovers/modals, not every card.
- **Icons:** one consistent 1.5–2px stroke family; labels for unfamiliar media functions; no emoji interface.
- **Motion:** 120ms feedback, 180–240ms panel transitions, 260ms max for major state changes; no parallax, idle motion or decorative spring storms. Honor `prefers-reduced-motion`.
- **Grid:** 12-column max ~1280px with fluid side gutters; clean 72px app bar, generous media stage, slim configuration rail.
- **Feedback:** status copy and observable events take priority over arbitrary progress animation.

## Information architecture

Keep one application workspace with state changes rather than multiple marketing-like pages.

    /
      Empty state: import file
        ↓
      File analyzed: preview + format/intent
        ↓
      Processing: stage, cancel, details
        ↓
      Ready: preview, compare if AI, download, convert another

Secondary surfaces: format picker, advanced export drawer, file details, privacy tooltip, accessible keyboard help, clear error/retry dialog. They are overlays/panels, not destination pages.

### Desktop layout, 1440px reference

    ┌─────────────────────────────────────────────────────────────────────┐
    │ ◇ Any-Convert                                 Local when possible  │
    ├─────────────────────────────────────────────────────────────────────┤
    │                                                                     │
    │  INPUT                             OUTPUT                           │
    │  sample-video.mov · 00:36           MP4 · Universal                  │
    │                                                                     │
    │  ┌────────────────────────────────┐ ┌────────────────────────────┐  │
    │  │                                │ │ Convert                    │  │
    │  │                                │ │ Format            [MP4 ▾] │  │
    │  │         VIDEO PREVIEW          │ │ Quality     [Recommended]  │  │
    │  │                                │ │                            │  │
    │  │  ──────────●────────────       │ │ Extras                     │  │
    │  │  00:12                     ⛶  │ │ ○ Extract audio            │  │
    │  └────────────────────────────────┘ │ ○ Remove background        │  │
    │                                     │                            │  │
    │  1920 × 1080   24fps   H.264        │ [     Convert video     ]  │  │
    │  File details                  ▾    └────────────────────────────┘  │
    │                                                                     │
    │  Privacy & format compatibility notes when relevant                │
    └─────────────────────────────────────────────────────────────────────┘

Conceptual only; proportions should be tuned against actual screen-content and media aspect ratios. The preview is the dominant object. Secondary file metadata is concise and expandable.

### Empty state

- App bar contains the wordmark, understated privacy status, help and theme toggle only when implemented.
- Single large upload target with clear typographic action: **"Drop a video to begin"**; subline **"or choose a file"**.
- Secondary sentence: **"Convert, extract audio, or remove a background."** Do not claim unsupported formats here.
- Small capability reassurance: **"Processed on your device when supported."** Linked "How files are handled" content describes cloud fallback.
- Entire drop zone keyboard accessible; click/Enter/Space opens file picker. Drop target highlights without intrusive overlay.
- Support paste where the browser supplies a file; tell users what happened if their clipboard contains non-file text.
- On unsupported file, show file-specific detail and a supported alternative rather than a red error toast.
- No email entry, forced onboarding, scrolling sales content, fake testimonials, or watermark bait.

### File selected

- Immediately display name, file size, thumbnail/proxy if available and a **probing** state.
- Inspect all actual streams; show duration, dimensions, frame rate and source codec in a compact row.
- Populate a recommended conversion preset that is **actually supported** for this file. If stream-copy is safe, explain speed/quality benefits.
- Advanced controls only when requested. Preserve source frame rate, aspect ratio, rotation, audio language and highest sensible fidelity by default.
- Show output file size as *estimate*, never a guaranteed exact result. Explain unknown values if prediction is unavailable.
- Select **Convert**, **Extract audio**, **Remove background** via a small task switcher; avoid a complicated "all tools" menu.
- Local/cloud placement is visible adjacent to CTA. If local impossible, the CTA opens a clear cloud notice before bytes leave the device.
- Support replacing the input without losing app stability; optionally preserve chosen recipe when compatible.

### Background removal workspace

- Same app shell, but preview switches to a checkerboard-capable, scrubbable composition stage.
- Default semantic subject detection for humans; user may click a subject or refine the target on a frame.
- Compare **Original / Transparent / Composite** views; scrub both source and processed render at the same timestamp.
- Essential controls: Select subject, Keep/Remove correction (model dependent), Edge cleanup, Background (transparent / color / image), Output with alpha.
- Never claim that a binary segmentation mask is production-quality hair alpha; show source-quality preview and caveats.
- On-device WebGPU only if support and model availability checks pass. Tell users about one-time model download and CPU/GPU resource consumption.
- For cloud mode, show an explicit upload approval step. Show GPU processing as a separate phase and offer a fallback/alternative when it fails.
- Alpha export defaults to a verified compatible profile; if MP4 H.264 is selected, explain that it cannot export a transparent foreground in the chosen standard preset.
- Make it easy to discard a bad matte and return to basic conversion with the original input.

### Processing state

A progress view is not a spinner. It shows:
- Human-readable phase: Uploading / Inspecting / Waiting / Converting / Isolating subject / Packaging / Verifying.
- Percent and time estimate only when measured and sufficiently stable; queue wait may be indeterminate.
- Original/output filename, task, chosen format, transparent cloud-vs-local label and Cancel.
- Restorability: if cloud work survives closing tab, the next visit restores job via scoped session. Explain when local jobs cannot survive a tab close.
- Soft, precise animation: no fake velocity bars or permanent 99%.
- If retryable failure occurs, preserve file/recipe and offer **Try again**; show an error code under **Technical details**, never blame the user.

### Ready state

- Dominant playable output thumbnail/video (or audio waveform/download icon); format, size and duration summary.
- Primary CTA: **Download .mp4** (actual extension), with separate **Convert another** action.
- For AI results, original-vs-result comparison and a checkerboard background toggle before download.
- Optional secondary actions: duplicate recipe, export an alternative format, delete files now.
- Display expiry/retention transparently for cloud results. User must not discover expiration only after clicking a broken URL.
- Never label a job "complete" before downloadable output is verified.

## Motion and interaction quality

- The upload panel should *morph into* the media workspace while keeping the uploaded file visually anchored; no jarring route jump.
- Keep progress indicator in a stable location across upload→processing→ready.
- If the file picker is canceled, restore exact prior state with no error.
- Drop zone highlights on drag-enter without flicker as child nodes receive drag events.
- On tab/browser refresh during server work, restore stage and progress. Local processing has an explicit "keep this tab open" note.
- Input fields preserve focus on validation errors. Invalid codec/container combinations are removed or explained, not silently coerced.
- All actions are reversible until output generation when technically possible; cancel is clearly labeled and interrupts actual processing.
- Toasts are reserved for peripheral success/failure. Never use toast-only copy for critical state.
- Use optimistic UI only when action can be rolled back; file deletion and cancellation require server acknowledgement to claim success.
- When processing several files in a future batch flow, each row shows its own status and downloads; a bad file must not fail all others.

## Responsive behavior

| Width | Layout |
| --- | --- |
| ≤600px | Single column, compact app bar, full-width video, below-preview task controls, bottom safe-area-aware sticky primary CTA |
| 601–960px | Media preview followed by two-column metadata/actions where space permits |
| ≥961px | Dominant media + narrow right configuration rail; no fixed 300px rail that clips controls |
| Ultrawide | Max-width content; don't stretch a file picker across 2000px |

Respect the mobile browser's dynamic viewport, keyboard and safe-area. Pin the primary CTA only when it won't cover focusable content or app error messages. A tap is never required on a hover-only control.

## Copywriting style

Keep labels literal and short:

| Situation | Preferred | Avoid |
| --- | --- | --- |
| Import | "Drop a video to begin" | "Unleash limitless AI transformations" |
| Recommendation | "Recommended · Best compatibility" | "Ultimate quality" |
| File stays local | "On your device" | "100% private" if browser behavior not verified |
| Cloud consent | "This file needs cloud processing to use this format." | Silent upload |
| Waiting | "Waiting for a conversion worker" | Fake "72% complete" |
| AI caveat | "Fine details may need adjustment." | "Perfect background removal" |
| Error | "We couldn't decode the audio track. Try MP4 with AAC or view details." | "Oops! Something went wrong." |
| Finished | "Ready to download" | "Magic complete!" |

Include actionable errors for unsupported codec, damaged file, storage quota, upload interrupted, job timeout, GPU unsupported, model unavailable, license/format mismatch, and expired result.

## Component inventory (build real primitives)

- AppShell / Brand / PrivacyStatus
- DropTarget / ImportButton / FileChip / MetadataLine
- PreviewStage / MediaTimeline / TrackSelect / CheckerboardToggle / CompareSlider
- TaskSwitcher / FormatPicker / PresetItem / QualityControl / AdvancedDrawer
- CapabilityNotice / CloudConsentDialog
- JobStage / ProgressDetails / CancelAction / RetryPanel
- ExportSummary / DownloadButton / RetentionNotice
- AccessibleDialog / Popover / Tooltip / LiveRegion / ShortcutHelp

For each component: keyboard spec, semantic role, dark/media contrast, loading/disabled/error state, mobile interaction, test IDs and screenshot baseline. Prefer primitive composition over a sprawling custom design system.

## Accessibility target: WCAG 2.2 AA

- Entire flow works without drag-and-drop (browse), without a pointer (keyboard), and without motion.
- Proper labels, `aria-live` for meaningful stage changes, `role=progressbar` with values only when determinate, and explicit error descriptions.
- Focus management when dialog opens/closes and when upload/processing stages change. Never steal focus every second.
- Color contrast measured; non-color status signaling; visible focus that is not obscured; minimum target spacing.
- Shortcut legend and alternatives to scrubbing/dragging/painting; support screen reader announcements for timeline values.
- Audio/video content includes accessible transport controls. No forced autoplay with sound.
- Respect high zoom (200–400%), text resizing, reduced transparency and reduced motion.
- Validate with automated tests plus keyboard and actual screen reader manual testing.

Reference: [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/).

## Performance and craft budgets (targets, not achieved metrics)

- Main workspace LCP ≤2.5s, INP ≤200ms and CLS ≤0.1 on a representative mid-range mobile device and realistic network.
- Main thread interactions feel immediate; decoding/transcode/ML belong in workers where available.
- Preview seeks should be responsive; create an intentionally small preview proxy on cloud path where direct browser preview is impossible.
- Avoid downloading model weights on page load. Load matting models **only on intent**, with size disclosure and progress.
- Lazy-load rare advanced controls, a11y-safe motion assets and AI UI.
- Keep JS bundle and image/media bytes inside explicit budgets established via a real performance report in Phase 0.
- Check real devices for high-DPI media preview, long filename truncation, safe-area spacing, blurry thumbnails and one-handed mobile use.

## Design QA sign-off

Before calling any visual surface complete, review screenshot captures (empty, selected, local, cloud-consent, progress, error, AI preview, ready) in Chrome, Safari, Firefox and mobile. Check type rhythm, alignment, contrast, hover/pressed/focus/disabled states, RTL overflow risk, screen reader labels, touch target size, visual regression deltas and motion reduction. Every visible control must work.

**The brand will come from craft and trust, not visual gimmicks.**
