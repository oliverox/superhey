import { describe, expect, it } from 'vitest'
import { worthReading } from '../src/today/paperTrail'

describe('worthReading (Paper Trail)', () => {
  it('reads security alerts, bills and deadlines', () => {
    for (const s of [
      'Chase security alert: You signed in with a new device',
      'Your credit card statement is available',
      'Your Amazon Visa automatic payment is scheduled',
      "We've received your United Explorer Visa payment",
      'Vote in the Take-Two Interactive Software, Inc. Annual Meeting',
      '[Venmo] Your bank account has been added and verified',
    ])
      expect(worthReading(s), s).toBe(true)
  })

  it('leaves marketing and general notices alone', () => {
    for (const s of [
      'New IPO: Oura Inc. (OURA) is now on Robinhood',
      'Get 3% cash back with the Gold Card',
      'Top 6 ways to protect your account',
      'Do more, get more with Venmo Stash',
      'Are your goals on track?',
      'You are missing out on 401(k) money available to you!',
    ])
      expect(worthReading(s), s).toBe(false)
  })
})
