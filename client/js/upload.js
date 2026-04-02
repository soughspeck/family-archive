import { api } from './api.js';
// ─── Upload flow ──────────────────────────────────────────────────────────────
let selectedFiles = [];
let people = [];
let events = [];
export async function openUploadModal() {
    const modal = document.getElementById('upload-modal');
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    [people, events] = await Promise.all([
        api.people.list().catch(() => []),
        api.events.list().catch(() => []),
    ]);
    selectedFiles = [];
    renderUploadStep1();
    document.getElementById('upload-close').onclick = closeUploadModal;
    document.getElementById('upload-backdrop').onclick = closeUploadModal;
}
export function closeUploadModal() {
    document.getElementById('upload-modal').classList.add('hidden');
    document.body.style.overflow = '';
}
function renderUploadStep1() {
    const content = document.getElementById('upload-content');
    content.innerHTML = `
    <h2 class="upload-title">Add to Archive</h2>

    <div class="drop-zone" id="drop-zone">
      <div class="drop-zone-icon">📷</div>
      <div class="drop-zone-text">Drop photos, videos, or documents here</div>
      <div class="drop-zone-sub">or tap to browse files</div>
      <input type="file" id="file-input" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx" style="display:none">
    </div>

    <div id="file-preview-list" class="upload-file-list"></div>

    <div class="btn-row" style="display:none" id="step1-actions">
      <button class="btn btn-ghost" id="btn-cancel-upload">Cancel</button>
      <button class="btn btn-primary" id="btn-next-upload">Continue →</button>
    </div>`;
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer?.files.length)
            handleFiles(Array.from(e.dataTransfer.files));
    });
    fileInput.addEventListener('change', () => {
        if (fileInput.files?.length)
            handleFiles(Array.from(fileInput.files));
    });
    document.getElementById('btn-cancel-upload')?.addEventListener('click', closeUploadModal);
    document.getElementById('btn-next-upload')?.addEventListener('click', renderUploadStep2);
}
function handleFiles(files) {
    selectedFiles = [...selectedFiles, ...files];
    renderFilePreviews();
    const actions = document.getElementById('step1-actions');
    actions.style.display = selectedFiles.length > 0 ? 'flex' : 'none';
}
function renderFilePreviews() {
    const list = document.getElementById('file-preview-list');
    list.innerHTML = selectedFiles.map((f, i) => {
        const isImage = f.type.startsWith('image/');
        const icon = f.type.startsWith('video/') ? '🎬' : f.type.startsWith('audio/') ? '🎵' : '📄';
        const size = f.size < 1024 * 1024
            ? `${(f.size / 1024).toFixed(0)} KB`
            : `${(f.size / (1024 * 1024)).toFixed(1)} MB`;
        return `
      <div class="upload-file-item" data-index="${i}">
        ${isImage
            ? `<img class="upload-file-thumb" id="thumb-${i}" alt="">`
            : `<div class="upload-file-thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.4rem">${icon}</div>`}
        <span class="upload-file-name">${escHtml(f.name)}</span>
        <span class="upload-file-size">${size}</span>
      </div>`;
    }).join('');
    // Generate image previews
    selectedFiles.forEach((f, i) => {
        if (!f.type.startsWith('image/'))
            return;
        const img = document.getElementById(`thumb-${i}`);
        if (!img)
            return;
        const reader = new FileReader();
        reader.onload = e => { if (e.target?.result)
            img.src = e.target.result; };
        reader.readAsDataURL(f);
    });
}
function renderUploadStep2() {
    const content = document.getElementById('upload-content');
    const peopleOptions = people
        .map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`)
        .join('');
    const eventOptions = events
        .map(e => `<option value="${e.id}">${escHtml(e.title)}</option>`)
        .join('');
    content.innerHTML = `
    <h2 class="upload-title">Uploading ${selectedFiles.length} file${selectedFiles.length !== 1 ? 's' : ''}</h2>

    <div class="upload-meta-fields">
      <div class="field-row">
        <label class="field-label" for="meta-date">Date (leave blank to use EXIF)</label>
        <input type="text" id="meta-date" class="field-input" placeholder="e.g. 1987, 1987-06, 1987-06-14">
      </div>

      <div class="field-row">
        <label class="field-label" for="meta-precision">Date precision</label>
        <select id="meta-precision" class="field-input">
          <option value="">Auto-detect</option>
          <option value="exact">Exact</option>
          <option value="day">Day</option>
          <option value="month">Month</option>
          <option value="year">Year only</option>
          <option value="circa">Circa / approximate</option>
          <option value="unknown">Unknown</option>
        </select>
      </div>

      <div class="field-row">
        <label class="field-label" for="meta-people">People in these photos</label>
        <select id="meta-people" class="field-input" multiple size="3">
          ${peopleOptions || '<option disabled>No people added yet</option>'}
        </select>
      </div>

      <div class="field-row">
        <label class="field-label" for="meta-event">Event</label>
        <select id="meta-event" class="field-input">
          <option value="">None</option>
          ${eventOptions}
        </select>
      </div>

      <div class="field-row">
        <label class="field-label" for="meta-notes">Notes</label>
        <textarea id="meta-notes" class="field-input" rows="2" placeholder="Any notes about these photos…"></textarea>
      </div>
    </div>

    <div class="btn-row">
      <button class="btn btn-ghost" id="btn-back-upload">← Back</button>
      <button class="btn btn-primary" id="btn-submit-upload">Upload</button>
    </div>

    <div id="upload-progress" class="upload-progress" style="display:none">
      <span id="upload-progress-text">Uploading…</span>
      <div class="progress-bar"><div class="progress-bar-fill" id="progress-fill"></div></div>
    </div>`;
    document.getElementById('btn-back-upload').addEventListener('click', renderUploadStep1);
    document.getElementById('btn-submit-upload').addEventListener('click', submitUpload);
}
async function submitUpload() {
    const dateVal = document.getElementById('meta-date').value.trim();
    const precision = document.getElementById('meta-precision').value;
    const peopleSel = document.getElementById('meta-people');
    const eventVal = document.getElementById('meta-event').value;
    const notes = document.getElementById('meta-notes').value.trim();
    const selectedPeople = Array.from(peopleSel.selectedOptions).map(o => o.value).filter(Boolean);
    const submitBtn = document.getElementById('btn-submit-upload');
    submitBtn.disabled = true;
    const progressDiv = document.getElementById('upload-progress');
    const progressText = document.getElementById('upload-progress-text');
    const progressFill = document.getElementById('progress-fill');
    progressDiv.style.display = 'block';
    let uploaded = 0;
    for (const file of selectedFiles) {
        progressText.textContent = `Uploading ${file.name}…`;
        progressFill.style.width = `${Math.round((uploaded / selectedFiles.length) * 100)}%`;
        const fd = new FormData();
        fd.append('files', file);
        if (dateVal)
            fd.append('taken_at_manual', dateVal);
        if (precision)
            fd.append('date_precision_manual', precision);
        if (selectedPeople.length)
            fd.append('person_ids', selectedPeople.join(','));
        if (eventVal)
            fd.append('event_id', eventVal);
        if (notes)
            fd.append('notes', notes);
        try {
            await api.assets.upload(fd);
        }
        catch {
            // best-effort, continue with other files
        }
        uploaded++;
    }
    progressFill.style.width = '100%';
    progressText.textContent = `Done! ${uploaded} file${uploaded !== 1 ? 's' : ''} uploaded.`;
    setTimeout(() => {
        closeUploadModal();
        // Reload the page so timeline refreshes
        window.location.reload();
    }, 1200);
}
function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
//# sourceMappingURL=upload.js.map