export const BREAKING_SECTION = 'breaking'

export const DEFAULT_SECTION_TITLES: Record<string, Record<string, string>> = {
  'en': {
    added: 'New features',
    [BREAKING_SECTION]: 'Breaking changes',
    changed: 'Improvements',
    fixed: 'Bug fixes',
  },
  'pt-BR': {
    added: 'Novidades',
    [BREAKING_SECTION]: 'Mudanças incompatíveis',
    changed: 'Melhorias',
    fixed: 'Correções',
  },
}

export const DEFAULT_SUPPORT_SECTIONS: Record<string, string> = {
  'en': '### Support\n\nThis project is built and maintained on personal time. If it is useful to you, consider [sponsoring the work]({url}) — it keeps the development, the testing and the releases coming.\n',
  'pt-BR': '### Apoio\n\nEste projeto é desenvolvido e mantido em tempo pessoal. Se ele for útil para você, considere [apoiar o trabalho]({url}) — isso mantém o desenvolvimento, os testes e os releases em andamento.\n',
}
