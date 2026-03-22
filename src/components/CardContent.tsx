import { useMemo } from 'react';
import { View, Text, Platform, useWindowDimensions } from 'react-native';
import RenderHtml, {
  HTMLContentModel,
  HTMLElementModel,
  type CustomTagRendererRecord,
  type MixedStyleDeclaration,
} from 'react-native-render-html';
import { marked } from 'marked';

interface Props {
  children: string;
  foregroundColor: string;
}

const customHTMLElementModels = {
  ruby: HTMLElementModel.fromCustomModel({
    tagName: 'ruby' as any,
    contentModel: HTMLContentModel.mixed,
  }),
  rt: HTMLElementModel.fromCustomModel({
    tagName: 'rt' as any,
    contentModel: HTMLContentModel.textual,
  }),
};

function extractRubyParts(tnode: any): { base: string; annotation: string } {
  let base = '';
  let annotation = '';
  for (const child of tnode.children) {
    if (child.tagName === 'rt') {
      annotation += child.data ?? '';
    } else if ('data' in child) {
      base += child.data;
    }
  }
  return { base, annotation };
}

export function CardContent({ children, foregroundColor }: Props) {
  const { width } = useWindowDimensions();

  const html = useMemo(() => {
    return marked.parse(children, { async: false }) as string;
  }, [children]);

  const renderers: CustomTagRendererRecord = useMemo(() => ({
    ruby: ({ tnode }: any) => {
      const { base, annotation } = extractRubyParts(tnode);

      if (Platform.OS === 'web') {
        return (
          <ruby style={{ fontSize: 28, color: foregroundColor }}>
            {base}
            <rt style={{ fontSize: 12, color: foregroundColor, paddingBottom: 4 }}>{annotation}</rt>
          </ruby>
        );
      }

      // Native: stack pinyin above character
      return (
        <View style={{ alignItems: 'center', marginHorizontal: 2 }}>
          <Text style={{ fontSize: 12, color: foregroundColor }}>{annotation}</Text>
          <Text style={{ fontSize: 28, color: foregroundColor }}>{base}</Text>
        </View>
      );
    },
  }), [foregroundColor]);

  const baseStyle: MixedStyleDeclaration = useMemo(
    () => ({ fontSize: 28, color: foregroundColor, textAlign: 'center' }),
    [foregroundColor],
  );

  const tagsStyles = useMemo(
    () => ({
      p: { margin: 0 } as MixedStyleDeclaration,
      em: { fontStyle: 'italic' } as MixedStyleDeclaration,
      strong: { fontWeight: 'bold' } as MixedStyleDeclaration,
      blockquote: {
        borderLeftWidth: 3,
        borderLeftColor: '#888',
        paddingLeft: 12,
      } as MixedStyleDeclaration,
    }),
    [],
  );

  return (
    <RenderHtml
      contentWidth={width}
      source={{ html }}
      baseStyle={baseStyle}
      tagsStyles={tagsStyles}
      customHTMLElementModels={customHTMLElementModels}
      renderers={renderers}
    />
  );
}
