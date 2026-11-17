import { useRef, useState } from 'react';
import type { SaboraiSubscription } from '../components/WelcomeGate';
import { initialTenant } from '../data/mockData';
import type { TenantInfo, UserProfile } from '../types';
import {
  readInitialCurrentUser,
  readInitialSubscription,
  readInitialTenant
} from '../services/sessionTenant';

export function useSessionTenantState() {
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(readInitialCurrentUser);
  const [subscription, setSubscription] = useState<SaboraiSubscription | null>(readInitialSubscription);
  const [skipSubscriptionGate, setSkipSubscriptionGate] = useState(false);
  const [tenant, setTenant] = useState<TenantInfo>(() => readInitialTenant(initialTenant));
  const activeTenantIdRef = useRef(tenant.id);

  return {
    isLoadingAuth,
    setIsLoadingAuth,
    currentUser,
    setCurrentUser,
    subscription,
    setSubscription,
    skipSubscriptionGate,
    setSkipSubscriptionGate,
    tenant,
    setTenant,
    activeTenantIdRef
  };
}
