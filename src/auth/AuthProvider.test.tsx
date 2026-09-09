// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const unsubscribe = vi.fn();
  let listener: ((event: string, session: unknown) => void) | undefined;
  return {
    unsubscribe,
    getSession: vi.fn(),
    signInWithPassword: vi.fn(),
    signInWithOAuth: vi.fn(),
    signOut: vi.fn(),
    refreshSession: vi.fn(),
    auth: {
      getSession: vi.fn(),
      signInWithPassword: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
      refreshSession: vi.fn(),
      onAuthStateChange: vi.fn((callback) => {
        listener = callback;
        return { data: { subscription: { unsubscribe } } };
      }),
    },
    emit(event: string, session: unknown) { listener?.(event, session); },
  };
});

state.auth.getSession = state.getSession;
state.auth.signInWithPassword = state.signInWithPassword;
state.auth.signInWithOAuth = state.signInWithOAuth;
state.auth.signOut = state.signOut;
state.auth.refreshSession = state.refreshSession;
vi.mock('@/auth/supabase', () => ({ supabase: { auth: state.auth } }));

import { AuthProvider, useAuth } from './AuthProvider';

const session = { access_token: 'token', user: { id: 'user-1' } };
const wrapper = ({ children }: PropsWithChildren) => <AuthProvider>{children}</AuthProvider>;

describe('AuthProvider', () => {
  beforeEach(() => {
    state.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
    state.signInWithPassword.mockReset().mockResolvedValue({ error: null });
    state.signInWithOAuth.mockReset().mockResolvedValue({ error: null });
    state.signOut.mockReset().mockResolvedValue({ error: null });
    state.unsubscribe.mockReset();
  });

  it('restores and follows the active session', async () => {
    state.getSession.mockResolvedValue({ data: { session }, error: null });
    const { result, unmount } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isRestoring).toBe(true);
    await waitFor(() => expect(result.current.isRestoring).toBe(false));
    expect(result.current.session).toBe(session);
    act(() => state.emit('SIGNED_OUT', null));
    expect(result.current.session).toBeNull();
    unmount();
    expect(state.unsubscribe).toHaveBeenCalledOnce();
  });

  it('delegates password and GitHub sign-in without retaining credentials', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isRestoring).toBe(false));
    state.signInWithPassword.mockResolvedValueOnce({ error: new Error('Invalid credentials') });
    await expect(result.current.signInWithPassword('a@example.com', 'bad')).rejects.toThrow('Invalid credentials');
    expect(state.signInWithPassword).toHaveBeenCalledWith({ email: 'a@example.com', password: 'bad' });
    await result.current.signInWithGitHub('https://example.com/flash-card/');
    expect(state.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'github',
      options: { redirectTo: 'https://example.com/flash-card/' },
    });
    await result.current.signOut();
    expect(state.signOut).toHaveBeenCalledOnce();
  });
});
