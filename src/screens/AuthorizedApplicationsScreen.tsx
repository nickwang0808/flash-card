import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';

import { supabase } from '@/auth/supabase';
import { ScreenState } from '@/components/feedback/ScreenState';
import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';

interface AuthorizedApplication {
  clientId: string;
  clientName: string;
  scopes: readonly string[];
  grantedAt: string;
}

export function AuthorizedApplicationsScreen() {
  const [applications, setApplications] = useState<readonly AuthorizedApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingClientId, setRevokingClientId] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const { data, error: grantsError } = await supabase.auth.oauth.listGrants();
    if (grantsError || !data) {
      setError(grantsError?.message ?? 'Authorized applications could not be loaded');
      return;
    }
    setApplications(data.map((grant) => ({
      clientId: grant.client.id,
      clientName: grant.client.name,
      scopes: grant.scopes,
      grantedAt: grant.granted_at,
    })));
  };

  useEffect(() => { void load(); }, []);

  const revoke = async (application: AuthorizedApplication) => {
    setError(null);
    setRevokingClientId(application.clientId);
    try {
      const { error: revokeError } = await supabase.auth.oauth.revokeGrant({ clientId: application.clientId });
      if (revokeError) throw revokeError;
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Application access could not be revoked');
    } finally {
      setRevokingClientId(null);
    }
  };

  if (applications === null && !error) return <ScreenState loading title="Loading authorized applications" />;
  if (applications === null) return <ScreenState actionLabel="Retry" detail={error ?? undefined} onAction={() => void load()} title="Could not load authorized applications" />;

  return <ScrollView className="flex-1 bg-background" contentContainerClassName="mx-auto w-full max-w-md gap-4 p-5">
    <View className="flex-row items-start justify-between gap-4">
      <View className="flex-1 gap-1"><Heading size="2xl">Authorized applications</Heading><Text className="text-muted-foreground">Revoke applications that should no longer access your Flash Cards account.</Text></View>
      <Button onPress={() => router.back()} size="sm" variant="outline"><ButtonText>Back</ButtonText></Button>
    </View>
    {error ? <ScreenState actionLabel="Retry" detail={error} onAction={() => void load()} title="Could not update applications" /> : null}
    {applications.length === 0 ? <ScreenState title="No authorized applications" detail="CLI and future integrations appear here after you approve them." /> : applications.map((application) => <Card className="gap-3 p-4" key={application.clientId}>
      <View className="gap-1"><Heading size="md">{application.clientName}</Heading><Text className="text-muted-foreground">Granted {new Date(application.grantedAt).toLocaleDateString()}</Text></View>
      <Text className="text-muted-foreground">{application.scopes.length > 0 ? application.scopes.join(', ') : 'Basic account access'}</Text>
      <Button isDisabled={revokingClientId !== null} onPress={() => void revoke(application)} variant="outline">
        {revokingClientId === application.clientId ? <ButtonSpinner /> : null}<ButtonText>Revoke access</ButtonText>
      </Button>
    </Card>)}
  </ScrollView>;
}
