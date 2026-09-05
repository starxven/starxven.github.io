// Force-download helper: fetch as blob and trigger download. Falls back to navigating to the download URL if fetch fails.
async function forceDownloadBlob(filename) {
  const downloadBase = (window.location.hostname === 'localhost') ? 'http://localhost:3000/media/download/' : '/media/download/';
  const url = downloadBase + encodeURIComponent(filename);
  try {
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) throw new Error('download failed ' + resp.status);
    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
    return true;
  } catch (e) {
    console.warn('forceDownloadBlob failed', e);
    // final fallback: navigate to URL (server Content-Disposition should handle download)
    window.location.href = url;
    return false;
  }
}

// Replace the previous download logic with forceDownloadBlob call
const downloadBtn2 = document.getElementById('downloadBtn');
if (downloadBtn2) {
  downloadBtn2.disabled = true; // initially disabled until a video is generated
  downloadBtn2.addEventListener('click', async () => {
    if (!lastGeneratedVideoUrl) return alert('No hay video generado para descargar.');
    const filename = lastGeneratedVideoName || lastGeneratedVideoUrl.split('/').pop();
    await forceDownloadBlob(filename);
  });
}
