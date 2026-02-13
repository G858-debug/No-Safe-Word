"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { NswUser } from "@no-safe-word/shared";

interface AuthContextValue {
  user: User | null;
  nswUser: NswUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  nswUser: null,
  loading: true,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [nswUser, setNswUser] = useState<NswUser | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  const fetchNswUser = useCallback(
    async (authUserId: string) => {
      const { data } = await supabase
        .from("nsw_users")
        .select("*")
        .eq("auth_user_id", authUserId)
        .single();
      setNswUser((data as NswUser) ?? null);
    },
    [supabase]
  );

  useEffect(() => {
    // Get initial session
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) {
        fetchNswUser(user.id);
      }
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (currentUser) {
        fetchNswUser(currentUser.id);
      } else {
        setNswUser(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [supabase, fetchNswUser]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setNswUser(null);
  }, [supabase]);

  return (
    <AuthContext.Provider value={{ user, nswUser, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
