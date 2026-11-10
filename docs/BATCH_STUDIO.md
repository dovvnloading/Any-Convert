# Local Batch Studio

A user-selectable `/batch` workspace creates independently verified,
on-device MP4/MOV/WebM/MP3/WAV/FLAC outputs from up to eight media files.
Files can be selected, dropped, or pasted from a clipboard that exposes audio/video File objects (Ctrl/⌘+V). Text, screenshots and pastes into form fields are left alone. Eight-file and size limits also apply to pasted media.
Only supported source/output pairs are queued. The work queue runs **one
browser media worker at a time** to limit memory pressure, with honest
progress, cancellation and a per-export retry button. No background cloud job
or automatic remote upload exists.

A preset called **creator pack** selects MP4/WebM/MP3; actual supported
pairs are evaluated per file by the Intelligence Core. Users can choose
formats, quality and maximum height explicitly.

Completed jobs have individual downloads; the optional ZIP pack uses a
**bounded, STORE-only ZIP32 writer** with streaming Blob reads and output to
browser origin-private file storage. The ZIP contains actual media files,
not placeholders. The writer verifies byte counts and is tested with a
standard Python ZIP reader. ZIP size is limited to 2 GiB and 48 entries;
large batches can always download files individually.

Temporary results are cleared on batch replacement or route disposal. The
storage cleanup module also sweeps stale files on subsequent visits. A
browser crash may leave temporary files until cleanup or site data deletion.
Codec and 1 GB experimental storage limitations remain device-specific.

Out of scope: resumable browser jobs across refresh, background persistent
tasks, cross-device collaboration, server-side ZIP packaging, AI functions,
and guaranteed large-file compatibility on every browser.
