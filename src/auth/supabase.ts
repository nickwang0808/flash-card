import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { readFrontendEnvironment } from '@/api/environment';

const environment = readFrontendEnvironment();

export const supabase = createClient(environment.supabaseUrl, environment.supabasePublishableKey, {
  auth: Platform.select({
    native: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    default: undefined,
  }),
});
