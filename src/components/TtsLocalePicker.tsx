import { useMemo } from 'react';

interface Props {
  voices: SpeechSynthesisVoice[];
  onSelect: (lang: string) => void;
  onDismiss: () => void;
}

export function TtsLocalePicker({ voices, onSelect, onDismiss }: Props) {
  // Deduplicate by lang code, keeping one representative name per language
  const languages = useMemo(() => {
    const map = new Map<string, string>();
    for (const voice of voices) {
      if (!map.has(voice.lang)) {
        map.set(voice.lang, voice.lang);
      }
    }
    return Array.from(map.keys()).sort();
  }, [voices]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onDismiss}
    >
      <div
        className="bg-background border border-border rounded-lg shadow-lg max-w-sm w-full max-h-[70vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold">Select Language</h2>
          <button
            onClick={onDismiss}
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            Cancel
          </button>
        </div>
        <div className="overflow-y-auto p-2">
          {languages.length === 0 ? (
            <p className="text-sm text-muted-foreground p-3">
              No voices available. Your browser may not support speech synthesis.
            </p>
          ) : (
            languages.map(lang => (
              <button
                key={lang}
                onClick={() => onSelect(lang)}
                className="w-full text-left px-3 py-2 text-sm rounded hover:bg-accent"
              >
                {lang}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
