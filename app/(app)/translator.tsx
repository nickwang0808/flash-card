import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useDeckNames } from '@/hooks/useDeck';
import { getDatabaseSync } from '@/services/rxdb';
import { supabase } from '@/services/supabase';
import { translate } from '@/services/translate';
import { buildCard } from '@/services/card-creator';

const LANGUAGES = [
  'English',
  'Spanish',
  'Chinese (Mandarin)',
  'French',
  'German',
  'Japanese',
  'Korean',
  'Portuguese',
  'Italian',
];

const STORAGE_KEY = 'translator-prefs';

function loadPrefs(): { fromLang: string; toLang: string; deckName: string } {
  if (Platform.OS !== 'web') return { fromLang: 'English', toLang: 'Spanish', deckName: '' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { fromLang: 'English', toLang: 'Spanish', deckName: '' };
}

function savePrefs(prefs: { fromLang: string; toLang: string; deckName: string }) {
  if (Platform.OS !== 'web') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch {}
}

type SaveStatus = 'idle' | 'saved' | 'duplicate' | 'error';

export default function TranslatorScreen() {
  const router = useRouter();
  const { data: deckNames } = useDeckNames();

  const prefs = useRef(loadPrefs());
  const [fromLang, setFromLang] = useState(prefs.current.fromLang);
  const [toLang, setToLang] = useState(prefs.current.toLang);
  const [deckName, setDeckName] = useState(prefs.current.deckName);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Default deck to first available
  useEffect(() => {
    if (!deckName && deckNames.length > 0) {
      setDeckName(deckNames[0]);
    }
  }, [deckNames, deckName]);

  // Persist prefs on change
  useEffect(() => {
    savePrefs({ fromLang, toLang, deckName });
  }, [fromLang, toLang, deckName]);

  const handleSwap = useCallback(() => {
    setFromLang(toLang);
    setToLang(fromLang);
    setInput('');
    setOutput('');
    setSaveStatus('idle');
  }, [fromLang, toLang]);

  const doTranslate = useCallback(async (text: string, from: string, to: string) => {
    if (!text.trim()) {
      setOutput('');
      return;
    }

    setLoading(true);
    setSaveStatus('idle');
    try {
      const { translation } = await translate(text.trim(), from, to);
      setOutput(translation);
    } catch (err) {
      console.error('Translation failed:', err);
      setSaveStatus('error');
    } finally {
      setLoading(false);
    }
  }, []);

  const [saving, setSaving] = useState(false);

  const handleAddToDeck = useCallback(async () => {
    if (!output || !deckName || saving) return;

    const term = output;
    const back = input.trim();

    setSaving(true);
    try {
      const db = getDatabaseSync();

      // Check for duplicate
      const existing = await db.cards.find({
        selector: { deckName, term },
      }).exec();
      if (existing.length > 0) {
        setSaveStatus('duplicate');
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const card = buildCard({
        userId: user.id,
        deckName,
        term,
        translation: back,
      });
      await db.cards.insert(card);
      setSaveStatus('saved');
    } catch (err) {
      console.error('Failed to save card:', err);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  }, [output, input, deckName, saving]);

  const handleInputChange = useCallback((text: string) => {
    setInput(text);
    setOutput('');
    setSaveStatus('idle');

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim()) return;

    debounceRef.current = setTimeout(() => {
      doTranslate(text, fromLang, toLang);
    }, 800);
  }, [fromLang, toLang, doTranslate]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <ScrollView className="flex-1 p-4 max-w-md mx-auto w-full">
      {/* Header */}
      <View className="flex-row items-center justify-between mb-6">
        <Pressable role="button" onPress={() => router.back()}>
          <Text className="text-sm text-muted-foreground">Back</Text>
        </Pressable>
        <Text className="text-xl font-bold text-foreground">Translate</Text>
        <View className="w-10" />
      </View>

      {/* Language selectors + swap */}
      {Platform.OS === 'web' && (
        <div className="flex flex-row items-center gap-2 mb-4">
          <div className="flex-1">
            <select
              value={fromLang}
              onChange={(e: any) => setFromLang(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>

          <Pressable
            role="button"
            onPress={handleSwap}
            className="rounded-md border border-input px-3 py-2"
          >
            <Text className="text-sm text-foreground">⇄</Text>
          </Pressable>

          <div className="flex-1">
            <select
              value={toLang}
              onChange={(e: any) => setToLang(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Deck selector */}
      {Platform.OS === 'web' && deckNames.length > 0 && (
        <div className="mb-4">
          <Text className="text-sm font-medium text-foreground mb-1">Deck</Text>
          <select
            value={deckName}
            onChange={(e: any) => setDeckName(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {deckNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Input */}
      <View className="mb-4">
        <TextInput
          value={input}
          onChangeText={handleInputChange}
          placeholder={`Type in ${fromLang}...`}
          placeholderTextColor="#9ca3af"
          multiline
          className="w-full rounded-md border border-input bg-background px-3 py-3 text-foreground min-h-[100px]"
          style={{ textAlignVertical: 'top' }}
        />
      </View>

      {/* Output */}
      <View className="mb-4 rounded-md border border-border bg-muted/30 px-3 py-3 min-h-[100px]">
        {loading ? (
          <Text className="text-sm text-muted-foreground">Translating...</Text>
        ) : output ? (
          <Text className="text-foreground">{output}</Text>
        ) : (
          <Text className="text-sm text-muted-foreground">Translation will appear here</Text>
        )}
      </View>

      {/* Add to Deck button */}
      {output && saveStatus !== 'saved' && (
        <Pressable
          role="button"
          onPress={handleAddToDeck}
          disabled={saving}
          className="w-full rounded-md bg-primary px-4 py-2.5 items-center mb-3"
        >
          <Text className="text-sm font-medium text-primary-foreground">
            {saving ? 'Adding...' : `Add to ${deckName}`}
          </Text>
        </Pressable>
      )}

      {/* Save status */}
      {saveStatus === 'saved' && (
        <Text className="text-sm text-green-500 text-center">Card added to {deckName}</Text>
      )}
      {saveStatus === 'duplicate' && (
        <Text className="text-sm text-yellow-500 text-center">Already in {deckName}</Text>
      )}
      {saveStatus === 'error' && (
        <Text className="text-sm text-red-500 text-center">Translation failed</Text>
      )}
    </ScrollView>
  );
}
