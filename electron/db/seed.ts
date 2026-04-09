import Database from 'better-sqlite3'

interface CompanySeed {
  name: string
  relationship: 'board_seat' | 'board_observer' | 'deal' | 'other'
  domain?: string
}

const PORTFOLIO_COMPANIES: CompanySeed[] = [
  // Board seats
  { name: 'Arcol', relationship: 'board_seat', domain: 'arcol.io' },
  { name: 'Cartwheel', relationship: 'board_seat', domain: 'cartwheel.com' },
  { name: 'ConverseNow Technologies', relationship: 'board_seat', domain: 'conversenow.ai' },
  { name: 'Fellow Insights', relationship: 'board_seat', domain: 'fellow.app,fellow.co' },
  { name: 'First Resonance', relationship: 'board_seat', domain: 'firstresonance.io' },
  { name: 'Greenlite Technologies', relationship: 'board_seat', domain: 'greenlite.ai' },
  { name: 'Meez Culinary Solutions', relationship: 'board_seat', domain: 'getmeez.com' },
  { name: 'NorthSpyre', relationship: 'board_seat', domain: 'northspyre.com' },
  { name: 'Sendoso', relationship: 'board_seat', domain: 'sendoso.com' },
  { name: 'Arovy (Sonar)', relationship: 'board_seat', domain: 'sonar.watch' },
  { name: 'Spekit', relationship: 'board_seat', domain: 'spekit.co' },
  { name: 'Vooma', relationship: 'board_seat', domain: 'vooma.ai' },
  // Board observers
  { name: 'Camber', relationship: 'board_observer', domain: 'camber.co' },
  { name: 'Bandana', relationship: 'board_observer', domain: 'bandana.com' },
  { name: 'Trusted', relationship: 'board_observer', domain: 'trusted.com' },
  { name: 'Koyfin', relationship: 'board_observer', domain: 'koyfin.com' },
  { name: 'Streetfair', relationship: 'board_observer', domain: 'streetfair.com' },
  { name: 'Sensible', relationship: 'board_observer', domain: 'sensible.so' },
]

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function seedPortfolioCompanies(db: Database.Database): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO companies (id, name, relationship, domain)
    VALUES (?, ?, ?, ?)
  `)

  const transaction = db.transaction(() => {
    for (const company of PORTFOLIO_COMPANIES) {
      insert.run(
        slugify(company.name),
        company.name,
        company.relationship,
        company.domain || null
      )
    }
  })

  transaction()
  console.log(`[DB] Seeded ${PORTFOLIO_COMPANIES.length} portfolio companies`)
}
