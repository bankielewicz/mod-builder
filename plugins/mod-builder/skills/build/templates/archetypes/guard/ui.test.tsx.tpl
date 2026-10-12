import { describe, expect, mock, test } from 'claude-code/testing'

describe('ui', () => {
  test('a risky command waits for the person: Deny refuses it, Allow runs it', async ($, on) => {
    mock.clock(on)
    const ran: string[] = []
    let answer = 'Deny'
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    on('command.register', () => ({ value: undefined }) as never)
    // $.ui.ask is a tool.call of AskUserQuestion; the answer is keyed by the question text.
    on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
      const { questions } = e as unknown as { questions: { question: string }[] }
      return { result: { questions, answers: { [questions[0]!.question]: answer } } } as never
    })
    on('tool.call', { tool: 'Bash' }, ($, e) => (ran.push(e.command), { result: { stdout: '', stderr: '', interrupted: false } }) as never)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })

    const denied = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as never)
    expect(denied.deny).toStartWith('__NAME__: the person declined')
    expect(ran).toEqual([])

    answer = 'Allow once'
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as never)
    await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
    expect(ran).toEqual(['rm -rf build', 'ls'])
  })
})
