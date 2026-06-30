import { createContext, useContext } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const ThemeContext = createContext({
  theme: 'light' as Theme,
  setTheme: (_theme: Theme) => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return children;
}

export function useTheme() {
  return useContext(ThemeContext);
}
