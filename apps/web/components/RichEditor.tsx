'use client';
import { useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  Eraser,
  Film,
  Heading2,
  Heading3,
  Heading4,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Table,
  Underline,
  Undo2,
  Unlink,
  Youtube,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useApp } from './Provider';
import { IMAGE_ACCEPT, prepareImage } from './ImageCropper';
import { Modal } from './UI';

/** A YouTube, Vimeo or Facebook video page turned into the address of its player, or '' if unknown. */
export function embedAddress(url: string) {
  const u = url.trim();
  const yt = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,})/.exec(u);
  if (yt) return 'https://www.youtube.com/embed/' + yt[1];
  const vimeo = /vimeo\.com\/(?:video\/)?(\d+)/.exec(u);
  if (vimeo) return 'https://player.vimeo.com/video/' + vimeo[1];
  if (/^https:\/\/(www\.|m\.|web\.)?facebook\.com\/.+\/videos?\/|^https:\/\/fb\.watch\//.test(u))
    return 'https://www.facebook.com/plugins/video.php?href=' + encodeURIComponent(u) + '&show_text=false';
  return '';
}
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Dialog = { kind: 'link' | 'video' | 'image'; url: string; text: string; alt?: string } | null;

/**
 * The article editor: headings, formatting, lists, alignment, links, pictures (cropped first),
 * uploaded or YouTube/Vimeo/Facebook videos, tables, undo and an HTML view. The API cleans the
 * HTML again when the article is saved.
 */
export function RichEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const { notice } = useApp();
  const area = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const [source, setSource] = useState(false);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [, redraw] = useState(0);
  const imagePicker = useRef<HTMLInputElement>(null);
  const videoPicker = useRef<HTMLInputElement>(null);

  // The editable area is filled once (and when coming back from the HTML view); typing then
  // updates the value without re-rendering the text, so the cursor never jumps.
  useEffect(() => {
    if (!source && area.current && area.current.innerHTML !== value) area.current.innerHTML = value || '<p><br></p>';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
  const sync = () => area.current && onChange(area.current.innerHTML);
  const remember = () => {
    const s = window.getSelection();
    if (s && s.rangeCount && area.current?.contains(s.anchorNode)) saved.current = s.getRangeAt(0).cloneRange();
  };
  const restore = () => {
    area.current?.focus();
    const s = window.getSelection();
    if (saved.current && s) {
      s.removeAllRanges();
      s.addRange(saved.current);
    }
  };
  const run = (command: string, arg?: string) => {
    restore();
    document.execCommand(command, false, arg);
    sync();
    remember();
    redraw((n) => n + 1);
  };
  const insert = (html: string) => run('insertHTML', html);
  const active = (command: string) => {
    try {
      return typeof document !== 'undefined' && document.queryCommandState(command);
    } catch {
      return false;
    }
  };

  async function uploadPicture(file: File) {
    const ready = await prepareImage(file, { aspect: 16 / 9 });
    if (!ready) return;
    setBusy('Uploading picture…');
    try {
      const form = new FormData();
      form.append('file', ready);
      const { url } = await api<{ url: string }>('/manage/images', { method: 'POST', body: form });
      setDialog({ kind: 'image', url, text: '', alt: '' });
    } finally {
      setBusy('');
    }
  }
  async function uploadVideo(file: File) {
    if (file.size > 60 * 1024 * 1024) return notice('Videos can be up to 60 MB. For longer videos, use a YouTube link.');
    setBusy('Uploading video…');
    try {
      const form = new FormData();
      form.append('file', file);
      const { url } = await api<{ url: string }>('/manage/videos', { method: 'POST', body: form });
      insert(`<figure><video controls playsinline preload="metadata" src="${url}"></video></figure><p><br></p>`);
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  function confirmDialog() {
    if (!dialog) return;
    if (dialog.kind === 'link') {
      const href = dialog.url.trim();
      if (!/^(https?:\/\/|\/|mailto:|tel:)/.test(href)) return notice('Use a full address such as https://… or a site path such as /search.');
      const selected = saved.current && !saved.current.collapsed;
      if (selected) run('createLink', href);
      else insert(`<a href="${escape(href)}">${escape(dialog.text || href)}</a>&nbsp;`);
    } else if (dialog.kind === 'video') {
      const src = embedAddress(dialog.url);
      if (!src) return notice('Paste a YouTube, Vimeo or Facebook video link.');
      insert(
        `<div class="video-embed"><iframe src="${escape(src)}" title="Video" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen frameborder="0"></iframe></div><p><br></p>`,
      );
    } else {
      insert(
        `<figure><img src="${escape(dialog.url)}" alt="${escape(dialog.alt || '')}">${dialog.text ? `<figcaption>${escape(dialog.text)}</figcaption>` : ''}</figure><p><br></p>`,
      );
    }
    setDialog(null);
  }
  const words = (value || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  const tool = (label: string, icon: React.ReactNode, onClick: () => void, on = false) => (
    <button
      type="button"
      className={'rte-btn' + (on ? ' on' : '')}
      title={label}
      aria-label={label}
      aria-pressed={on}
      disabled={source && label !== 'HTML view'}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  );
  return (
    <div className={'rte' + (full ? ' full' : '')}>
      <div className="rte-toolbar" role="toolbar" aria-label="Formatting">
        {tool('Undo', <Undo2 size={15} />, () => run('undo'))}
        {tool('Redo', <Redo2 size={15} />, () => run('redo'))}
        <span className="rte-sep" />
        {tool('Paragraph', <Pilcrow size={15} />, () => run('formatBlock', 'P'))}
        {tool('Heading', <Heading2 size={15} />, () => run('formatBlock', 'H2'))}
        {tool('Subheading', <Heading3 size={15} />, () => run('formatBlock', 'H3'))}
        {tool('Small heading', <Heading4 size={15} />, () => run('formatBlock', 'H4'))}
        {tool('Quote', <Quote size={15} />, () => run('formatBlock', 'BLOCKQUOTE'))}
        {tool('Code', <Code2 size={15} />, () => run('formatBlock', 'PRE'))}
        <span className="rte-sep" />
        {tool('Bold', <Bold size={15} />, () => run('bold'), active('bold'))}
        {tool('Italic', <Italic size={15} />, () => run('italic'), active('italic'))}
        {tool('Underline', <Underline size={15} />, () => run('underline'), active('underline'))}
        {tool('Strikethrough', <Strikethrough size={15} />, () => run('strikeThrough'), active('strikeThrough'))}
        <label className="rte-color" title="Text colour" onMouseDown={remember}>
          <span>A</span>
          <input type="color" disabled={source} onChange={(e) => run('foreColor', e.target.value)} aria-label="Text colour" />
        </label>
        <span className="rte-sep" />
        {tool('Bulleted list', <List size={15} />, () => run('insertUnorderedList'), active('insertUnorderedList'))}
        {tool('Numbered list', <ListOrdered size={15} />, () => run('insertOrderedList'), active('insertOrderedList'))}
        {tool('Align left', <AlignLeft size={15} />, () => run('justifyLeft'))}
        {tool('Align centre', <AlignCenter size={15} />, () => run('justifyCenter'))}
        {tool('Align right', <AlignRight size={15} />, () => run('justifyRight'))}
        {tool('Justify', <AlignJustify size={15} />, () => run('justifyFull'))}
        <span className="rte-sep" />
        {tool('Link', <Link2 size={15} />, () => {
          remember();
          setDialog({ kind: 'link', url: 'https://', text: window.getSelection()?.toString() || '' });
        })}
        {tool('Remove link', <Unlink size={15} />, () => run('unlink'))}
        {tool('Picture', <ImageIcon size={15} />, () => {
          remember();
          imagePicker.current?.click();
        })}
        {tool('Upload a video', <Film size={15} />, () => {
          remember();
          videoPicker.current?.click();
        })}
        {tool('YouTube, Vimeo or Facebook video', <Youtube size={15} />, () => {
          remember();
          setDialog({ kind: 'video', url: '', text: '' });
        })}
        {tool('Table', <Table size={15} />, () =>
          insert(
            `<table><thead><tr><th>Heading</th><th>Heading</th><th>Heading</th></tr></thead><tbody>${'<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>'.repeat(2)}</tbody></table><p><br></p>`,
          ),
        )}
        {tool('Divider', <Minus size={15} />, () => run('insertHorizontalRule'))}
        {tool('Clear formatting', <Eraser size={15} />, () => run('removeFormat'))}
        <span className="rte-sep" />
        {tool('HTML view', <span className="rte-html">&lt;/&gt;</span>, () => {
          if (source && area.current) area.current.innerHTML = value;
          setSource((s) => !s);
        }, source)}
        {tool(full ? 'Exit full screen' : 'Full screen', full ? <Minimize2 size={15} /> : <Maximize2 size={15} />, () => setFull((f) => !f))}
      </div>
      {source ? (
        <textarea className="rte-source" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} aria-label="Article HTML" />
      ) : (
        <div
          ref={area}
          className="rte-area blog-content"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline
          aria-label="Article"
          onInput={sync}
          onKeyUp={remember}
          onMouseUp={() => {
            remember();
            redraw((n) => n + 1);
          }}
          onBlur={remember}
          onPaste={(e) => {
            // Pasted pictures are uploaded; pasted text keeps simple formatting only.
            const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
            if (file) {
              e.preventDefault();
              remember();
              uploadPicture(file).catch((err) => notice(err.message));
            }
          }}
        />
      )}
      <div className="rte-foot">
        <small className="muted">{busy || `${words.toLocaleString('en-PK')} words · about ${Math.max(1, Math.round(words / 200))} min read`}</small>
      </div>
      <input
        ref={imagePicker}
        type="file"
        hidden
        accept={IMAGE_ACCEPT}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) uploadPicture(f).catch((err) => notice(err.message));
        }}
      />
      <input
        ref={videoPicker}
        type="file"
        hidden
        accept="video/mp4,video/webm"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) uploadVideo(f);
        }}
      />
      <Modal
        open={!!dialog}
        onClose={() => setDialog(null)}
        size="sm"
        title={dialog?.kind === 'link' ? 'Add a link' : dialog?.kind === 'video' ? 'Add a video' : 'Picture details'}
      >
        {dialog && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              confirmDialog();
            }}
          >
            {dialog.kind === 'image' ? (
              <>
                <img src={dialog.url} alt="" className="rte-dialog-img" />
                <label>
                  Description for search engines and screen readers
                  <input value={dialog.alt} maxLength={200} onChange={(e) => setDialog({ ...dialog, alt: e.target.value })} placeholder="What the picture shows" />
                </label>
                <label>
                  Caption <span className="muted">(optional)</span>
                  <input value={dialog.text} maxLength={300} onChange={(e) => setDialog({ ...dialog, text: e.target.value })} />
                </label>
              </>
            ) : (
              <>
                <label>
                  {dialog.kind === 'link' ? 'Address' : 'YouTube, Vimeo or Facebook video link'}
                  <input
                    required
                    autoFocus
                    value={dialog.url}
                    onChange={(e) => setDialog({ ...dialog, url: e.target.value })}
                    placeholder={dialog.kind === 'link' ? 'https://… or /search' : 'https://www.youtube.com/watch?v=…'}
                  />
                </label>
                {dialog.kind === 'link' && !(saved.current && !saved.current.collapsed) && (
                  <label>
                    Link text
                    <input value={dialog.text} onChange={(e) => setDialog({ ...dialog, text: e.target.value })} />
                  </label>
                )}
              </>
            )}
            <div className="form-foot">
              <button type="button" className="button ghost" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button className="button">Insert</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
