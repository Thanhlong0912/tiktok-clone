"use client"

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from "@/libs/supabase"
import { User, UserContextTypes } from '../types';
import { useRouter } from 'next/navigation';
import useGetProfileByUserId from '../hooks/useGetProfileByUserId';

const UserContext = createContext<UserContextTypes | null>(null);

const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null);
  // Starts true: on the very first render nobody knows yet whether there is a
  // session. Only ever flipped to false, so a later auth change cannot make a
  // gated page flash its loading state again.
  const [isCheckingUser, setIsCheckingUser] = useState<boolean>(true);

  const checkUser = async () => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) {
        setUser(null)
        return
      }

      const profile = await useGetProfileByUserId(authUser.id)

      setUser({
        id: authUser.id,
        name: profile?.name || authUser.user_metadata?.name,
        bio: profile?.bio,
        image: profile?.image,
      });
    } catch (error) {
      setUser(null);
    } finally {
      setIsCheckingUser(false)
    }
  };

  useEffect(() => {
    checkUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      checkUser()
    })

    return () => subscription.unsubscribe()
  }, []);

  const register = async (name: string, email: string, password: string) => {

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } },
      })

      if (error) throw error

      // The profile row is created by the on_auth_user_created trigger.
      if (!data.session) {
        throw new Error('Please confirm your email address before logging in.')
      }

      await checkUser()

    } catch (error) {
      console.error(error);
      throw error;
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) throw error

      await checkUser();
    } catch (error) {
      console.error(error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      const { error } = await supabase.auth.signOut()

      if (error) throw error

      setUser(null);
      router.refresh()
    } catch (error) {
      console.error(error);
    }
  };

  return (
      <UserContext.Provider value={{ user, isCheckingUser, register, login, logout, checkUser }}>
          {children}
      </UserContext.Provider>
  );
};

export default UserProvider;

export const useUser = () => useContext(UserContext)
