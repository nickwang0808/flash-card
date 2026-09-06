import { useState } from 'react';
import { View } from 'react-native';

import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { FormControl, FormControlError, FormControlErrorText, FormControlLabel, FormControlLabelText } from '@/components/ui/form-control';
import { Input, InputField } from '@/components/ui/input';

interface SignInFormProps {
  onSubmit(email: string, password: string): Promise<void>;
}

export function SignInForm({ onSubmit }: SignInFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(email.trim(), password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in');
    } finally {
      setIsSubmitting(false);
    }
  };

  return <View className="w-full gap-5">
    <FormControl isInvalid={Boolean(error)}>
      <FormControlLabel><FormControlLabelText>Email</FormControlLabelText></FormControlLabel>
      <Input><InputField autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={setEmail} placeholder="you@example.com" testID="email" value={email} /></Input>
    </FormControl>
    <FormControl isInvalid={Boolean(error)}>
      <FormControlLabel><FormControlLabelText>Password</FormControlLabelText></FormControlLabel>
      <Input><InputField autoComplete="current-password" onChangeText={setPassword} placeholder="Password" secureTextEntry testID="password" value={password} /></Input>
      {error ? <FormControlError><FormControlErrorText>{error}</FormControlErrorText></FormControlError> : null}
    </FormControl>
    <Button isDisabled={isSubmitting || !email.trim() || !password} onPress={submit} testID="sign-in">
      {isSubmitting ? <ButtonSpinner /> : null}<ButtonText>Sign in</ButtonText>
    </Button>
  </View>;
}
