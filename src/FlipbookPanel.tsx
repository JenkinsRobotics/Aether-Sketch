import { AetherIcon, BottomPanel, IconButton, MenuButton, NumberField, Timeline } from '@aether/ui';
import type { Flipbook } from './document';

/** The flipbook's bottom editor: a timeline with one mark per frame, playback, and the frame commands.
 * Frames are layers; the timeline only says which one shows. */
export function FlipbookPanel({ book, index, frameName, playing, onion, busy, onSeek, onPlay, onFps, onOnion, onAdd, onDuplicate, onRemove, onCommand }: {
  book: Flipbook; index: number; frameName: string; playing: boolean; onion: boolean; busy: boolean;
  onSeek: (index: number) => void; onPlay: () => void; onFps: (fps: number) => void; onOnion: () => void; onAdd: () => void; onDuplicate: () => void; onRemove: () => void; onCommand: (id: string) => void;
}) {
  const count = book.frames.length, last = count - 1;
  return <BottomPanel ariaLabel="Flipbook" activeID="flipbook" onSelect={() => {}}
    actions={<>
      {/* The compact timeline has play and scrub; stepping and speed sit here. (The full one offers only video frame rates.) */}
      <IconButton label="Previous frame" size="small" disabled={index <= 0} onClick={() => onSeek(index - 1)}><AetherIcon name="skip-back" /></IconButton>
      <IconButton label="Next frame" size="small" disabled={index >= last} onClick={() => onSeek(index + 1)}><AetherIcon name="skip-forward" /></IconButton>
      <NumberField aria-label="Frames per second" value={book.fps} min={1} max={60} step={1} precision={0} unit="fps" onCommit={onFps} />
      <IconButton label="Add a frame after this one" size="small" onClick={onAdd}><AetherIcon name="plus" /></IconButton>
      <IconButton label="Duplicate this frame" size="small" onClick={onDuplicate}><AetherIcon name="duplicate" /></IconButton>
      <IconButton label="Delete this frame" size="small" disabled={count < 2} onClick={onRemove}><AetherIcon name="delete" /></IconButton>
      <IconButton label="Onion skin: show the frames before and after, faintly" size="small" aria-pressed={onion} onClick={onOnion}><AetherIcon name="layers" /></IconButton>
      <MenuButton label="Flipbook export and options" disabled={busy} items={[{ id: 'flipbook-apng', label: 'Export animated PNG' }, { id: 'flipbook-video', label: 'Export video' }, { id: 'flipbook-frames', label: 'Export frames (PNG files in a ZIP)' },
        { id: 'flipbook-end', label: 'Stop using a flipbook (frames stay as layers)' }]} onSelect={onCommand}><AetherIcon name="export" /></MenuButton>
    </>}
    tabs={[{ id: 'flipbook', label: 'Flipbook', badge: `${index + 1} / ${count}`, icon: <AetherIcon name="film" />, content:
      <Timeline variant="compact" clipName="Flipbook" tracks={[{ id: 'frames', label: 'Frames', detail: frameName, keyframes: book.frames.map((_, i) => ({ timeS: i / book.fps })) }]}
        durationS={Math.max(last, 1) / book.fps} timeS={index / book.fps} framesPerSecond={book.fps} onFramesPerSecondChange={onFps} looping
        onSeek={time => onSeek(Math.min(last, Math.max(0, Math.round(time * book.fps))))} onStepFrame={direction => onSeek(Math.min(last, Math.max(0, index + direction)))}
        playing={playing} onTogglePlay={onPlay} onStop={() => onSeek(0)} selected={{ trackID: 'frames', index }} onSelectKeyframe={(_, frame) => onSeek(frame)} /> }]} />;
}
