import { describe, expect, it } from 'vitest'
import { gatesFixture } from './fixtures'
import { createLabeler } from './labels'

describe('label disambiguation', () => {
  const project = gatesFixture()
  const { labelFor } = createLabeler(project)
  const all = Object.values(project.nodes).map((n) => labelFor(n))

  it('gives every point a unique label', () => {
    // Two identical search results are worse than useless, so uniqueness is the contract.
    expect(new Set(all).size).toBe(all.length)
  })

  it('separates two corners off the same room by compass bearing', () => {
    // H01 and H02 both sit on the corridor outside 4401.
    const a = labelFor(project.nodes['GHC-4-H01'])
    const b = labelFor(project.nodes['GHC-4-H02'])
    expect(a).not.toBe(b)
    expect(a).toContain('hallway outside Gates 4401')
    expect(b).toContain('hallway outside Gates 4401')
    // H02 is east of H01, so the bearings must differ and name a direction.
    expect(`${a} ${b}`).toMatch(/east|west|north|south/)
  })

  it('leaves an already-unique label untouched', () => {
    expect(labelFor(project.nodes['GHC-4-R01'])).toBe('Rashid Auditorium (Gates 4401)')
    expect(labelFor(project.nodes['GHC-5-R01'])).toBe('Gates 5301')
  })

  it('distinguishes the same stairwell across floors', () => {
    const four = labelFor(project.nodes['GHC-4-S01'])
    const five = labelFor(project.nodes['GHC-5-S01'])
    expect(four).not.toBe(five)
    expect(four).toContain('the Helix')
    expect(five).toContain('the Helix')
  })
})
