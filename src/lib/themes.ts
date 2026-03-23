/**
 * Theme metadata — used by the settings UI picker.
 * CSS tokens are defined in app.css as :root[data-theme="<id>"] blocks.
 * The id is written to document.documentElement.dataset.theme by +layout.svelte.
 */

export interface ThemeInfo {
  id: string
  label: string
  /** Main background color — shown in the swatch preview */
  bg: string
  /** Accent color — shown in the swatch preview */
  accent: string
  /** Primary text color — shown in the swatch preview */
  text: string
}

export const THEMES: ThemeInfo[] = [
  {
    id: 'ayu-light',
    label: 'Ayu Light',
    bg: '#fafafa',
    accent: '#ff9940',
    text: '#575f66',
  },
  {
    id: 'adwaita-light',
    label: 'Adwaita Light',
    bg: '#fafafa',
    accent: '#3584e4',
    text: '#1c1c1e',
  },
  {
    id: 'base16-default',
    label: 'Base16 Default',
    bg: '#f8f8f8',
    accent: '#7cafc2',
    text: '#383838',
  },
  {
    id: 'catppuccin-latte',
    label: 'Catppuccin Latte',
    bg: '#eff1f5',
    accent: '#1e66f5',
    text: '#4c4f69',
  },
  {
    id: 'ingrid',
    label: 'Ingrid',
    bg: '#fffbf0',
    accent: '#c07028',
    text: '#3a3428',
  },
  {
    id: 'zed-onelight',
    label: 'Zed One Light',
    bg: '#fafafa',
    accent: '#4078f2',
    text: '#383a42',
  },
]

export const DEFAULT_THEME_ID = 'ayu-light'
