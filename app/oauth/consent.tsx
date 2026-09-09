import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { supabase } from '@/auth/supabase';
import { ScreenState } from '@/components/feedback/ScreenState';
import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';

interface AuthorizationDetails {
  authorizationId: string;
  clientName: string;
  redirectUri: string;
  scopes: string[];
}


export default function OAuthConsentRoute() {
  const { authorization_id: suppliedAuthorizationId } = useLocalSearchParams<{ authorization_id?: string | string[] }>();
  const authorizationId = typeof suppliedAuthorizationId === 'string' && suppliedAuthorizationId.length > 0 ? suppliedAuthorizationId : null;
  const { session, isRestoring } = useAuth();
  const router = useRouter();
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isRestoring || !authorizationId || !session) return;
    let mounted = true;
    void (async () => {
      try {
        const { data, error: authorizationError } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
        if (!mounted) return;
        if (authorizationError || !data) {
          setError(authorizationError?.message ?? 'Authorization request is invalid');
          return;
        }
        if ('redirect_url' in data) {
          await Linking.openURL(data.redirect_url);
          return;
        }
        setDetails({
          authorizationId: data.authorization_id,
          clientName: data.client.name,
          redirectUri: data.redirect_uri,
          scopes: data.scope.split(' ').filter(Boolean),
        });
      } catch (caught) {
        if (mounted) setError(caught instanceof Error ? caught.message : 'Authorization request is invalid');
      }
    })();
    return () => { mounted = false; };
  }, [authorizationId, isRestoring, session]);

  useEffect(() => {
    if (isRestoring || !authorizationId || session) return;
    router.replace({
      pathname: '/sign-in',
      params: { returnTo: `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}` },
    });
  }, [authorizationId, isRestoring, router, session]);

  const decide = async (approved: boolean) => {
    if (!details) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const { data, error: decisionError } = approved
        ? await supabase.auth.oauth.approveAuthorization(details.authorizationId, { skipBrowserRedirect: true })
        : await supabase.auth.oauth.denyAuthorization(details.authorizationId, { skipBrowserRedirect: true });
      if (decisionError || !data) throw decisionError ?? new Error('Authorization could not be completed');
      await Linking.openURL(data.redirect_url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Authorization could not be completed');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isRestoring || (authorizationId && !session) || (session && !details && !error)) {
    return <ScreenState loading title="Preparing authorization" />;
  }
  if (!authorizationId || error) {
    return <ScreenState title="Authorization unavailable" detail={error ?? 'Missing authorization request'} />;
  }
  if (!details) return <ScreenState loading title="Preparing authorization" />;


  return <View className="flex-1 items-center justify-center bg-background px-5">
    <Card className="w-full max-w-md gap-6 p-6">
      <View className="gap-2">
        <Heading size="2xl">Authorize {details.clientName}</Heading>
        <Text className="text-muted-foreground">This application will act as your Flash Cards account.</Text>
      </View>
      <View className="gap-1">
        <Text>Redirect URI</Text>
        <Text className="text-muted-foreground">{details.redirectUri}</Text>
      </View>
      <View className="gap-1">
        <Text>Requested access</Text>
        <Text className="text-muted-foreground">{details.scopes.length > 0 ? details.scopes.join(', ') : 'Basic account access'}</Text>
      </View>
      <View className="flex-row gap-3">
        <Button className="flex-1" isDisabled={isSubmitting} onPress={() => decide(false)} variant="outline">
          <ButtonText>Deny</ButtonText>
        </Button>
        <Button className="flex-1" isDisabled={isSubmitting} onPress={() => decide(true)}>
          {isSubmitting ? <ButtonSpinner /> : null}<ButtonText>Authorize</ButtonText>
        </Button>
      </View>
    </Card>
  </View>;
}
