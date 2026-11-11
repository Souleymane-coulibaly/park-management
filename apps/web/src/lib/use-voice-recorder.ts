'use client';

import { useEffect, useRef, useState } from 'react';
import { AI_AUDIO_MAX_BYTES } from '@ocall/shared';

/** Une minute au plus (limite de transcription d'Ocall AI Core). */
const MAX_SECONDS = 60;

/**
 * Enregistrement vocal dans le navigateur (micro autorisé par l'utilisateur), arrêté à une minute.
 * L'enregistrement n'est jamais conservé côté navigateur après son envoi.
 */
export function useVoiceRecorder(onRecorded: (audio: Blob) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  // Micro libéré si l'écran est quitté pendant l'enregistrement.
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((t) => t.stop()), []);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) recorder.current?.stop();
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [recording]);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const audio = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
        if (audio.size > AI_AUDIO_MAX_BYTES) {
          setError('Enregistrement trop long : une minute au plus.');
          return;
        }
        onRecorded(audio);
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setRecording(true);
    } catch {
      setError('Micro indisponible ou refusé : autorisez le micro, ou saisissez vos observations.');
    }
  }

  return { recording, seconds, error, start, stop: () => recorder.current?.stop() };
}
