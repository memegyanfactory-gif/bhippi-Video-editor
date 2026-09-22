// A model or checkpoint download's progress, wherever Helios reports one — a Whisper model, a
// Piper voice, a matting checkpoint, a video model. One component so a progress bar looks and
// behaves the same in every settings tab, instead of every tab inventing its own bar (or, worse,
// falling back to the browser's unstyled native <progress>).
export type DownloadJob = { progress: number; message: string; totalBytes?: number; downloadedBytes?: number };

const gb = (bytes: number) => (bytes / 1e9).toFixed(bytes >= 1e9 ? 2 : 1);

export function DownloadProgress({ job }: { job: DownloadJob }) {
  const sizeNote = job.totalBytes ? ` · ${gb(job.downloadedBytes ?? 0)} / ${gb(job.totalBytes)} GB` : '';
  return (
    <div className="model-progress">
      <div className="model-bar"><i style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
      <span className="muted small">{job.message}{sizeNote}</span>
    </div>
  );
}
