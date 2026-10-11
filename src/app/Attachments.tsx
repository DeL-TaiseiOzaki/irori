import {
  memo,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type RefObject,
} from 'react';
import {
  attachmentByteLimit,
  attachmentImageType,
  attachmentLimit,
  attachmentSize,
  type AttachmentRef,
} from '../domain/attachments';
import { t } from '../domain/i18n';
import { Icon } from './Icon';

const host = window.irori;

/** The words sent with files and nothing else, so the message says what it is for. */
export const attachedOnly = () =>
  t('添付したファイルを見てください。', 'Please look at the attached files.');

/** A file in the composer: on its way to irori's data directory, or kept there. */
export interface StagedAttachment {
  key: string;
  name: string;
  size: number;
  /** The image itself, for its thumbnail. */
  preview?: string;
  /** Set once irori keeps the file; the instruction sends this. */
  ref?: AttachmentRef;
}

function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
/** A pasted image has no name of its own; it gets one from its type. */
function fileName(file: File) {
  if (file.name) return file.name;
  const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
  return `${t('貼り付け', 'pasted')}-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
}

/**
 * The files attached to the next instruction. Each is kept by irori as soon as it
 * is added, so sending names files already in place; one removed before sending
 * is forgotten.
 */
export function useAttachments(onError: (error: unknown) => void) {
  const [items, setItems] = useState<StagedAttachment[]>([]);
  const count = useRef(0);
  const current = useRef(items);
  current.current = items;
  async function add(files: File[]) {
    const room = attachmentLimit - current.current.length;
    if (files.length > room)
      onError(
        t(
          `添付は 1 回に ${attachmentLimit} 個までです。`,
          `Up to ${attachmentLimit} files can be attached at once.`,
        ),
      );
    for (const file of files.slice(0, Math.max(room, 0))) {
      if (file.size > attachmentByteLimit) {
        onError(
          t(
            `${file.name} は 25 MB を超えるため添付できません。`,
            `${file.name} is over 25 MB and cannot be attached.`,
          ),
        );
        continue;
      }
      const key = `attachment-${++count.current}`;
      const name = fileName(file);
      const preview = attachmentImageType(name)
        ? await dataUrl(file).catch(() => undefined)
        : undefined;
      setItems((list) => [...list, { key, name, size: file.size, preview }]);
      try {
        const ref = await host.stageAttachment(name, new Uint8Array(await file.arrayBuffer()));
        // Removed while it was on its way: it is forgotten at once.
        if (!current.current.some((item) => item.key === key))
          void host.discardAttachment(ref.id).catch(() => {});
        else setItems((list) => list.map((item) => (item.key === key ? { ...item, ref } : item)));
      } catch (error) {
        setItems((list) => list.filter((item) => item.key !== key));
        onError(error);
      }
    }
  }
  function remove(key: string) {
    const item = current.current.find((entry) => entry.key === key);
    setItems((list) => list.filter((entry) => entry.key !== key));
    if (item?.ref) void host.discardAttachment(item.ref.id).catch(onError);
  }
  /** After sending: the files now belong to the conversation. */
  function clear() {
    setItems([]);
  }
  const files = (list: FileList | null | undefined) => [...(list ?? [])];
  return {
    items,
    refs: items.flatMap((item) => (item.ref ? [item.ref] : [])),
    /** A file is still on its way to irori. */
    pending: items.some((item) => !item.ref),
    add,
    remove,
    clear,
    onPaste(event: ClipboardEvent) {
      const pasted = files(event.clipboardData?.files);
      if (!pasted.length) return;
      event.preventDefault();
      void add(pasted);
    },
    onDragOver(event: DragEvent) {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    },
    onDrop(event: DragEvent) {
      const dropped = files(event.dataTransfer?.files);
      if (!dropped.length) return;
      event.preventDefault();
      void add(dropped);
    },
  };
}
export type Attachments = ReturnType<typeof useAttachments>;

/** The paperclip: picks files to attach. */
export function AttachButton({
  attachments,
  disabled,
}: {
  attachments: Attachments;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const label = t('ファイルを添付', 'Attach files');
  return (
    <>
      <button
        type="button"
        className="icon-button composer-tool"
        aria-label={label}
        title={label}
        disabled={disabled || attachments.items.length >= attachmentLimit}
        onClick={() => input.current?.click()}
      >
        <Icon name="attach" size={15} />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const picked = [...(event.target.files ?? [])];
          event.target.value = '';
          void attachments.add(picked);
        }}
      />
    </>
  );
}

/** Where irori can start the system's dictation: macOS and Windows. */
const dictationOffered =
  typeof navigator !== 'undefined' && /Mac|Win/.test(navigator.platform || navigator.userAgent);

/**
 * The microphone: puts the caret in the message box and starts the operating
 * system's dictation there (macOS 音声入力, Windows voice typing). The system
 * listens and types; irori records nothing.
 */
export function DictateButton({
  field,
  disabled,
  onError,
}: {
  field: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
  onError: (error: unknown) => void;
}) {
  if (!dictationOffered) return null;
  const label = t('音声入力', 'Dictate');
  return (
    <button
      type="button"
      className="icon-button composer-tool"
      aria-label={label}
      title={t('音声入力（OS の音声入力を使います）', "Dictate (uses the system's dictation)")}
      disabled={disabled}
      onClick={() => {
        const box = field.current;
        if (!box) return;
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
        void host
          .dictate()
          .then((started) => {
            if (!started)
              onError(
                t(
                  '音声入力を起動できませんでした。OS の設定で音声入力を有効にしてください。',
                  "Could not start dictation. Turn on the system's dictation in its settings.",
                ),
              );
          })
          .catch(onError);
      }}
    >
      <Icon name="mic" size={15} />
    </button>
  );
}

/** The files attached to the next instruction, above the message box. */
export function ComposerAttachments({ attachments }: { attachments: Attachments }) {
  if (!attachments.items.length) return null;
  return (
    <ul
      className="attachment-list composer-attachments"
      aria-label={t('添付ファイル', 'Attached files')}
    >
      {attachments.items.map((item) => (
        <li key={item.key} className={`attachment ${item.ref ? '' : 'pending'}`}>
          {item.preview ? (
            <img src={item.preview} alt="" className="attachment-thumb" />
          ) : (
            <Icon name="file" size={14} />
          )}
          <span className="attachment-name">{item.name}</span>
          <small>{item.ref ? attachmentSize(item.size) : t('準備中…', 'Preparing…')}</small>
          <button
            type="button"
            aria-label={t(`${item.name} を外す`, `Remove ${item.name}`)}
            onClick={() => attachments.remove(item.key)}
          >
            <Icon name="close" size={11} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** An image a message carried, read from irori's data directory when shown. */
function useAttachmentImage(ref: AttachmentRef) {
  const [src, setSrc] = useState<string | null>();
  const image = attachmentImageType(ref.name);
  useEffect(() => {
    if (!image) return;
    let live = true;
    void host
      .attachmentImage(ref.id)
      .then((bytes) =>
        bytes ? dataUrl(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: image })) : null,
      )
      .then(
        (value) => live && setSrc(value),
        () => live && setSrc(null),
      );
    return () => {
      live = false;
    };
  }, [ref.id]);
  return src;
}

const SentAttachment = memo(function SentAttachment({ attachment }: { attachment: AttachmentRef }) {
  const src = useAttachmentImage(attachment);
  return (
    <li className={`attachment ${src ? 'image' : ''}`}>
      <button
        type="button"
        title={attachment.name}
        aria-label={t(`${attachment.name} を開く`, `Open ${attachment.name}`)}
        onClick={() => void host.openAttachment(attachment.id).catch(() => {})}
      >
        {src ? (
          <img src={src} alt={attachment.name} className="attachment-image" />
        ) : (
          <>
            <Icon name="file" size={14} />
            <span className="attachment-name">{attachment.name}</span>
            <small>
              {src === null && attachmentImageType(attachment.name)
                ? t('この端末にありません', 'Not on this device')
                : attachmentSize(attachment.size)}
            </small>
          </>
        )}
      </button>
    </li>
  );
});

/** The files a sent message carried, with it in the log. */
export function MessageAttachments({ attachments }: { attachments?: AttachmentRef[] }) {
  if (!attachments?.length) return null;
  return (
    <ul className="attachment-list" aria-label={t('添付ファイル', 'Attached files')}>
      {attachments.map((attachment) => (
        <SentAttachment key={attachment.id} attachment={attachment} />
      ))}
    </ul>
  );
}
