import { useMemo } from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
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

const renderers: CustomTagRendererRecord = {
  ruby: ({ tnode }: any) => {
    // Extract base character and rt annotation from children
    let base = '';
    let annotation = '';
    for (const child of tnode.children) {
      if (child.tagName === 'rt') {
        // Get text from rt's children
        annotation = child.children
          .map((c: any) => c.data ?? '')
          .join('');
      } else if ('data' in child) {
        base += (child as any).data;
      }
    }
    return (
      <View style={{ alignItems: 'center', marginHorizontal: 2 }}>
        <Text style={{ fontSize: 28 }}>{base}</Text>
        <Text style={{ fontSize: 12, color: '#888' }}>{annotation}</Text>
      </View>
    );
  },
};

export function CardContent({ children, foregroundColor }: Props) {
  const { width } = useWindowDimensions();

  const html = useMemo(() => {
    const raw = marked.parse(children, { async: false }) as string;
    return raw;
  }, [children]);

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
