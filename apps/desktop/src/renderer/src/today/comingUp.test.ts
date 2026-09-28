import { describe, expect, it } from 'vitest'
import { canReply, quietName, taskUnder } from './comingUp'

describe('taskUnder', () => {
  it('drops what the date above already says', () => {
    expect(taskUnder('Check in for flight MK 288 to Antananarivo', 'Flight to Antananarivo (MK 288)')).toBe('Check in')
    expect(taskUnder('Attend MDA event', 'MDA event')).toBe('Attend')
    expect(taskUnder('Prepare for check-in at Catching Waves Retreat', 'Catching Waves Retreat check-in')).toBe('Prepare')
  })

  it('keeps a to-do that says something new', () => {
    expect(taskUnder('Bring the signed consent form', 'School trip')).toBe('Bring the signed consent form')
    expect(taskUnder('Pay the deposit for the school trip', 'School trip')).toBe('Pay the deposit')
    expect(taskUnder('Flight', 'Flight')).toBe('Flight')
  })
})

describe('canReply', () => {
  const p = (senderEmail: string, category: string | null) => ({ senderEmail, ai: category ? ({ category } as never) : null })
  it('not to addresses nobody reads, nor to a machine', () => {
    expect(canReply(p('noreply@airmauritius.com', 'booking'), 'move')).toBe(false)
    expect(canReply(p('do-not-reply@example.com', null), 'confirm')).toBe(false)
    expect(canReply(p('bookings@hotel.example', 'notification'), 'move')).toBe(false)
  })

  it('a booking can be asked to move, not confirmed', () => {
    expect(canReply(p('reservations@hotel.example', 'booking'), 'confirm')).toBe(false)
    expect(canReply(p('reservations@hotel.example', 'booking'), 'move')).toBe(true)
    expect(canReply(p('teacher@school.example', 'personal'), 'confirm')).toBe(true)
  })
})

describe('quietName', () => {
  it('stops a name in capitals from shouting', () => {
    expect(quietName('AIR MAURITIUS CALL CENTRE')).toBe('Air Mauritius Call Centre')
    expect(quietName('CARDCITY LLP')).toBe('Cardcity LLP')
    expect(quietName('Airbnb')).toBe('Airbnb')
    expect(quietName('DBS')).toBe('DBS')
  })
})
