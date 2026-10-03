import { useEffect, type ReactNode } from 'react';
import type { Format } from '@/types';
import { t } from '@/lib/i18n';
import { FORMATS, FORMAT_LIST } from '@/lib/formats';
import { useCaptureStore } from '@/store/captureStore';
import { useProjectStore } from '@/store/projectStore';
import { Button, Field, SegmentedControl, Select, TextInput, Toggle } from '@/app/ui';
import { Icon, type IconName } from '@/app/Icons';
import { getCaptureEngine } from './engine';
import { MicMeter } from './MicMeter';
import { pipCornerPosition, PIP_MAX_SIZE, PIP_MIN_SIZE, type CaptureLayout, type PipCorner, type PipShape, type ScreenFit, type TextPosition } from './layout';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-zinc-800 p-4">
      <h3 className="panel-title">{title}</h3>
      {children}
    </section>
  );
}

function SourceRow({ icon, label, on, children }: { icon: IconName; label: string; on: boolean; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-center gap-2">
        <Icon name={icon} className={`h-4 w-4 ${on ? 'text-emerald-400' : 'text-zinc-500'}`} />
        <span className="flex-1 text-sm font-medium">{label}</span>
        <span className={`h-2 w-2 rounded-full ${on ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
      </div>
      {children}
    </div>
  );
}

export function CaptureSettingsPanel() {
  const engine = getCaptureEngine();
  const settings = useCaptureStore((s) => s.settings);
  const update = useCaptureStore((s) => s.update);
  const updatePip = useCaptureStore((s) => s.updatePip);
  const webcamOn = useCaptureStore((s) => s.webcamOn);
  const screenOn = useCaptureStore((s) => s.screenOn);
  const micOn = useCaptureStore((s) => s.micOn);
  const micMuted = useCaptureStore((s) => s.micMuted);
  const videoDevices = useCaptureStore((s) => s.videoDevices);
  const audioDevices = useCaptureStore((s) => s.audioDevices);
  const webcamAspect = useCaptureStore((s) => s.webcamAspect);
  const recState = useCaptureStore((s) => s.recState);
  const projectFormat = useProjectStore((s) => s.project?.format);
  const busy = recState !== 'idle';

  useEffect(() => {
    void engine.refreshDevices();
  }, [engine]);

  const { width, height } = FORMATS[settings.format];
  const placeCorner = (corner: PipCorner) => updatePip(pipCornerPosition(corner, settings.pip, width, height, webcamAspect));

  return (
    <div className="text-sm">
      <Section title={t('capture.sources')}>
        <SourceRow icon="camera" label={t('capture.webcam')} on={webcamOn}>
          {videoDevices.length > 0 && (
            <Select
              aria-label={t('capture.device')}
              value={settings.webcamDeviceId}
              onChange={(e) => {
                update({ webcamDeviceId: e.target.value });
                if (webcamOn) void engine.enableWebcam(e.target.value || undefined);
              }}
            >
              <option value="">{t('capture.defaultDevice')}</option>
              {videoDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </Select>
          )}
          <Button
            size="sm"
            className="w-full"
            active={webcamOn}
            onClick={() => (webcamOn ? engine.disableWebcam() : void engine.enableWebcam(settings.webcamDeviceId || undefined))}
          >
            {webcamOn ? t('capture.disable') : t('capture.enable')}
          </Button>
        </SourceRow>

        <SourceRow icon="screen" label={t('capture.screen')} on={screenOn}>
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={settings.includeSystemAudio}
              onChange={(e) => update({ includeSystemAudio: e.target.checked })}
              className="accent-violet-500"
            />
            {t('capture.includeSystemAudio')}
          </label>
          <Button size="sm" className="w-full" active={screenOn} onClick={() => (screenOn ? engine.stopScreenShare() : void engine.startScreenShare())}>
            {screenOn ? t('capture.stopShare') : t('capture.shareScreen')}
          </Button>
        </SourceRow>

        <SourceRow icon={micMuted ? 'micOff' : 'mic'} label={t('capture.mic')} on={micOn}>
          {audioDevices.length > 0 && (
            <Select
              aria-label={t('capture.device')}
              value={settings.micDeviceId}
              onChange={(e) => {
                update({ micDeviceId: e.target.value });
                if (micOn) void engine.enableMic(e.target.value || undefined);
              }}
            >
              <option value="">{t('capture.defaultDevice')}</option>
              {audioDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </Select>
          )}
          {micOn && <MicMeter muted={micMuted} />}
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" active={micOn} onClick={() => (micOn ? engine.disableMic() : void engine.enableMic(settings.micDeviceId || undefined))}>
              {micOn ? t('capture.disable') : t('capture.enable')}
            </Button>
            {micOn && (
              <Button
                size="sm"
                icon={micMuted ? 'micOff' : 'mic'}
                title={micMuted ? t('tools.unmute') : t('tools.mute')}
                aria-label={micMuted ? t('tools.unmute') : t('tools.mute')}
                onClick={() => engine.setMicMuted(!micMuted)}
              />
            )}
          </div>
        </SourceRow>
        <p className="text-[11px] text-zinc-500">{t('capture.previewOnly')}</p>
      </Section>

      <Section title={t('capture.canvasFormat')}>
        <div className="grid grid-cols-3 gap-2">
          {FORMAT_LIST.map((f: Format) => (
            <button
              type="button"
              key={f}
              disabled={busy}
              onClick={() => update({ format: f })}
              title={FORMATS[f].hint}
              className={`flex flex-col items-center gap-1 rounded-lg border py-2 text-[11px] transition disabled:opacity-40 ${
                settings.format === f ? 'border-violet-500 bg-violet-500/10 text-violet-100' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'
              }`}
            >
              <span
                className={`block rounded-[2px] ${settings.format === f ? 'bg-violet-400' : 'bg-zinc-600'}`}
                style={{ height: 22, width: Math.round((22 * FORMATS[f].width) / FORMATS[f].height) }}
              />
              {FORMATS[f].label}
            </button>
          ))}
        </div>
        {projectFormat && projectFormat !== settings.format && (
          <p className="text-[11px] text-amber-400/90">{t('capture.formatMismatch', { project: projectFormat })}</p>
        )}
      </Section>

      <Section title={t('capture.layout')}>
        <Select value={settings.layout} onChange={(e) => update({ layout: e.target.value as CaptureLayout })}>
          <option value="screenPip">{t('capture.layout.screenPip')}</option>
          <option value="webcamOnly">{t('capture.layout.webcamOnly')}</option>
          <option value="screenOnly">{t('capture.layout.screenOnly')}</option>
        </Select>
        {settings.layout !== 'webcamOnly' && (
          <Field label={t('capture.screenFit')}>
            <SegmentedControl<ScreenFit>
              size="sm"
              value={settings.screenFit}
              onChange={(screenFit) => update({ screenFit })}
              options={[
                { value: 'contain', label: t('capture.screenFit.contain') },
                { value: 'cover', label: t('capture.screenFit.cover') },
              ]}
            />
          </Field>
        )}
        {settings.layout === 'screenPip' && (
          <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <span className="field-label">{t('capture.pip')}</span>
            <Field label={t('capture.pipPosition')} hint={t('capture.pos.hint')}>
              <div className="grid grid-cols-2 gap-1.5">
                {(['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as PipCorner[]).map((corner) => (
                  <Button key={corner} size="sm" onClick={() => placeCorner(corner)}>
                    {t(`capture.pos.${corner}`)}
                  </Button>
                ))}
              </div>
            </Field>
            <Field label={`${t('capture.pipSize')} · ${Math.round(settings.pip.size * 100)} %`}>
              <input
                type="range"
                min={PIP_MIN_SIZE}
                max={PIP_MAX_SIZE}
                step={0.01}
                value={settings.pip.size}
                onChange={(e) => updatePip({ size: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('capture.pipShape')}>
              <SegmentedControl<PipShape>
                size="sm"
                value={settings.pip.shape}
                onChange={(shape) => updatePip({ shape })}
                options={[
                  { value: 'circle', label: t('capture.pipShape.circle') },
                  { value: 'rounded', label: t('capture.pipShape.rounded') },
                  { value: 'square', label: t('capture.pipShape.square') },
                ]}
              />
            </Field>
          </div>
        )}
        <Toggle label={t('capture.mirror')} checked={settings.mirrorWebcam} onChange={(mirrorWebcam) => update({ mirrorWebcam })} />
        <Toggle label={t('capture.countdownToggle')} checked={settings.countdown} onChange={(countdown) => update({ countdown })} />
      </Section>

      <Section title={t('capture.texts')}>
        <Field label={t('capture.titleText')}>
          <TextInput value={settings.title} placeholder={t('capture.titlePlaceholder')} onChange={(e) => update({ title: e.target.value })} />
        </Field>
        <Field label={t('capture.subtitleText')}>
          <TextInput value={settings.subtitle} placeholder={t('capture.subtitlePlaceholder')} onChange={(e) => update({ subtitle: e.target.value })} />
        </Field>
        <div className="flex items-end gap-3">
          <Field label={t('capture.textColor')}>
            <input type="color" value={settings.textColor} onChange={(e) => update({ textColor: e.target.value })} />
          </Field>
          <div className="flex-1">
            <Field label={t('capture.textPosition')}>
              <SegmentedControl<TextPosition>
                size="sm"
                value={settings.textPosition}
                onChange={(textPosition) => update({ textPosition })}
                options={[
                  { value: 'top', label: t('capture.textPos.top') },
                  { value: 'center', label: t('capture.textPos.center') },
                  { value: 'bottom', label: t('capture.textPos.bottom') },
                ]}
              />
            </Field>
          </div>
        </div>
      </Section>
    </div>
  );
}
