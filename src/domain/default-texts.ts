export const BREAKING_SECTION = 'breaking'

export interface BuiltInTexts {
  sections: Record<string, string>
  support: string
}

const BUILT_IN_TEXTS: Record<string, BuiltInTexts> = {
  'en': {
    sections: {
      added: 'New features',
      [BREAKING_SECTION]: 'Breaking changes',
      changed: 'Improvements',
      fixed: 'Bug fixes',
    },
    support: '### Support\n\nThis project is built and maintained on personal time. If it is useful to you, consider [sponsoring the work]({url}) — it keeps the development, the testing and the releases coming.\n',
  },
  'pt-BR': {
    sections: {
      added: 'Novidades',
      [BREAKING_SECTION]: 'Mudanças incompatíveis',
      changed: 'Melhorias',
      fixed: 'Correções',
    },
    support: '### Apoio\n\nEste projeto é desenvolvido e mantido em tempo pessoal. Se ele for útil para você, considere [apoiar o trabalho]({url}) — isso mantém o desenvolvimento, os testes e os releases em andamento.\n',
  },
}

export function builtInTextsOf(language: string): BuiltInTexts | undefined {
  return BUILT_IN_TEXTS[language]
}
