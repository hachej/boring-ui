'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CameraIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useChatText } from '../pi-chat/labels';
import type { CameraSheetProps } from '../pi-chat/config';

export type { CameraSheetProps } from '../pi-chat/config';

// The in-page camera behind the composer's "Take a photo" (phones). getUserMedia is secure-context only and needs permission, so it is
// opened only when this sheet mounts (the person's tap on the menu item), through an injectable `getUserMedia` whose default
// feature-detects `navigator.mediaDevices.getUserMedia`. Where the stream cannot open (refused, unsupported, a Permissions-Policy, an
// insecure page) the sheet offers the phone's own camera through a file input instead. Same shape as feedback/voice/capture.ts.

/** The longest side of a captured photo, in pixels. */
export const CAMERA_MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;

type GetUserMedia = NonNullable<CameraSheetProps['getUserMedia']>;

/** The browser's camera, or null where the page cannot have one (insecure origin, no media devices). */
function browserGetUserMedia(): GetUserMedia | null {
  if (typeof globalThis.navigator?.mediaDevices?.getUserMedia !== 'function') return null;
  const devices = globalThis.navigator.mediaDevices;
  return constraints => devices.getUserMedia(constraints);
}

/** Full-screen camera above the agent layer (the app shell's point layer + 10): a live preview, a shutter and a close button. */
export function CameraSheet({ onCapture, onClose, getUserMedia }: CameraSheetProps) {
  const { labels } = useChatText();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const fallback = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [encoding, setEncoding] = useState(false);
  // The latest callbacks, so the stream effect runs once per mount.
  const latest = useRef({ onClose, getUserMedia });
  latest.current = { onClose, getUserMedia };

  const release = () => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; };
  useEffect(() => {
    let live = true;
    const open = latest.current.getUserMedia ?? browserGetUserMedia();
    (async () => {
      if (!open) throw new Error('no camera');
      // The rear camera if there is one; any camera otherwise.
      const media = await open({ video: { facingMode: 'environment' } }).catch(() => open({ video: true }));
      if (!live) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const element = video.current;
      if (!element) return;
      element.srcObject = media;
      await element.play();
      if (live) setReady(true);
    })().catch(() => { if (live) { release(); setFailed(true); } });
    return () => { live = false; release(); };
  }, []);
  // Escape closes the camera only: captured before the drawer or the dropdown behind it see it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); release(); latest.current.onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const close = () => { release(); onClose(); };
  const shoot = () => {
    const element = video.current;
    if (!element || !ready || encoding || !element.videoWidth || !element.videoHeight) return;
    const scale = Math.min(1, CAMERA_MAX_SIDE / Math.max(element.videoWidth, element.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(element.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(element.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) { setFailed(true); return; }
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    setEncoding(true);
    canvas.toBlob(blob => {
      setEncoding(false);
      if (!blob) { setFailed(true); return; }
      release();
      onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', JPEG_QUALITY);
  };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={labels.takePhoto} data-boring-overlay="" data-testid="camera-sheet"
      style={{ zIndex: 'calc(var(--app-shell-z-point, 60) + 10)' }}
      className="fixed inset-0 flex flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {failed
          ? <div className="flex flex-col items-center gap-3 p-6 text-center">
            <p role="alert" data-testid="camera-unavailable" className="text-sm text-muted-foreground">{labels.cameraUnavailable}</p>
            {/* Synchronous click: the browser opens the phone camera only from the person's tap. */}
            <Button type="button" data-testid="camera-fallback" className="min-h-11" onClick={() => fallback.current?.click()}>
              <CameraIcon data-icon="inline-start" aria-hidden="true" />{labels.cameraFallback}</Button>
            <Input ref={fallback} type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" className="sr-only" data-testid="camera-fallback-input"
              onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) onCapture(file); }} />
          </div>
          : <video ref={video} playsInline muted autoPlay data-testid="camera-video" className="size-full object-cover" />}
      </div>
      <div className="flex items-center justify-between p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button type="button" variant="ghost" size="icon-lg" data-testid="camera-close" aria-label={labels.cameraClose} title={labels.cameraClose} onClick={close}>
          <XIcon aria-hidden="true" /></Button>
        {!failed && <Button type="button" size="icon-lg" data-testid="camera-shoot" aria-label={labels.cameraShoot} title={labels.cameraShoot}
          disabled={!ready || encoding} onClick={shoot}><CameraIcon aria-hidden="true" /></Button>}
        <span className="w-9" aria-hidden="true" />
      </div>
    </div>, document.body);
}
