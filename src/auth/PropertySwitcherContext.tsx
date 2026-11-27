import { createContext, useContext, useState, type ReactNode } from 'react';

export interface ActivePropertyRef {
  id: string;
  name: string;
}

interface PropertySwitcherContextValue {
  activeProperty: ActivePropertyRef | null;
  setActiveProperty: (prop: ActivePropertyRef | null) => void;
}

const PropertySwitcherContext = createContext<PropertySwitcherContextValue>({
  activeProperty: null,
  setActiveProperty: () => {},
});

const STORAGE_KEY = 'fdp_super_active_property';

export function PropertySwitcherProvider({ children }: { children: ReactNode }) {
  const [activeProperty, setActivePropertyState] = useState<ActivePropertyRef | null>(() => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ActivePropertyRef) : null;
    } catch {
      return null;
    }
  });

  function setActiveProperty(prop: ActivePropertyRef | null) {
    setActivePropertyState(prop);
    try {
      if (prop) {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(prop));
      } else {
        window.sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore storage quota errors
    }
  }

  return (
    <PropertySwitcherContext.Provider value={{ activeProperty, setActiveProperty }}>
      {children}
    </PropertySwitcherContext.Provider>
  );
}

export function usePropertySwitcher(): PropertySwitcherContextValue {
  return useContext(PropertySwitcherContext);
}
