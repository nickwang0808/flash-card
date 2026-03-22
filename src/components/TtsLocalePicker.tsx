import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, Modal } from 'react-native';
import type { TtsVoice } from '../hooks/useTts';

interface Props {
  voices: TtsVoice[];
  onSelect: (lang: string) => void;
  onDismiss: () => void;
}

export function TtsLocalePicker({ voices, onSelect, onDismiss }: Props) {
  const languages = useMemo(() => {
    const set = new Set<string>();
    for (const voice of voices) {
      set.add(voice.language);
    }
    return Array.from(set).sort();
  }, [voices]);

  return (
    <Modal transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable
        onPress={onDismiss}
        className="flex-1 bg-black/50 items-center justify-center p-4"
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="bg-background border border-border rounded-lg w-full max-w-sm max-h-[70%]"
        >
          <View className="flex-row items-center justify-between p-4 border-b border-border">
            <Text className="text-lg font-semibold text-foreground">Select Language</Text>
            <Pressable onPress={onDismiss}>
              <Text className="text-sm text-muted-foreground">Cancel</Text>
            </Pressable>
          </View>
          <ScrollView className="p-2">
            {languages.length === 0 ? (
              <Text className="text-sm text-muted-foreground p-3">
                No voices available.
              </Text>
            ) : (
              languages.map((lang) => (
                <Pressable
                  key={lang}
                  onPress={() => onSelect(lang)}
                  className="w-full px-3 py-2 rounded"
                >
                  <Text className="text-sm text-foreground">{lang}</Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
