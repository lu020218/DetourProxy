import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_BYPASS_LIST,
  DEFAULT_STATE,
} from '../src/core/constants.js';
import type {
  Protocol,
  ProxyMode,
  ProxyEndpoint,
  ProxyConfiguration,
  PersistedState,
  ProxyStatus,
  ValidationResult,
  FieldError,
  EndpointInput,
} from '../src/core/types.js';

describe('project setup', () => {
  it('exposes the default bypass list with localhost and loopback (Req 4.4, 4.6)', () => {
    expect(DEFAULT_BYPASS_LIST).toEqual(['localhost', '127.0.0.1']);
  });

  it('exposes a default state that falls back to Direct mode (Req 5.3)', () => {
    expect(DEFAULT_STATE.effectiveMode).toBe('Direct');
    expect(DEFAULT_STATE.enabled).toBe(false);
    expect(DEFAULT_STATE.configuration.endpoint).toBeNull();
    expect(DEFAULT_STATE.configuration.pac).toBeNull();
    expect(DEFAULT_STATE.configuration.bypassList).toEqual(['localhost', '127.0.0.1']);
    expect(DEFAULT_STATE.schemaVersion).toBe(1);
  });

  it('keeps the default state bypass list independent from the constant', () => {
    expect(DEFAULT_STATE.configuration.bypassList).not.toBe(DEFAULT_BYPASS_LIST);
  });

  it('allows the shared types to be constructed (compile-time check)', () => {
    const protocol: Protocol = 'SOCKS5';
    const mode: ProxyMode = 'Fixed_Servers';
    const endpoint: ProxyEndpoint = { host: 'example.lan', port: 1080, protocol };
    const config: ProxyConfiguration = {
      endpoint,
      bypassList: [...DEFAULT_BYPASS_LIST],
      pac: null,
    };
    const state: PersistedState = {
      schemaVersion: 1,
      configuration: config,
      effectiveMode: mode,
      selectedMode: 'Fixed_Servers',
      enabled: true,
    };
    const status: ProxyStatus = {
      effectiveMode: mode,
      selectedMode: 'Fixed_Servers',
      endpoint,
      pac: null,
      errorActive: false,
      errorEndpoint: null,
    };
    const error: FieldError = { field: 'host', message: '主机地址无效' };
    const result: ValidationResult<ProxyEndpoint> = { ok: true, value: endpoint };
    const input: EndpointInput = { host: 'example.lan', port: '1080', protocol: 'SOCKS5' };

    expect(state.configuration.endpoint?.port).toBe(1080);
    expect(status.effectiveMode).toBe('Fixed_Servers');
    expect(error.field).toBe('host');
    expect(result.ok).toBe(true);
    expect(input.protocol).toBe('SOCKS5');
  });

  it('runs fast-check property tests (test harness smoke check)', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        return n + 0 === n;
      }),
      { numRuns: 100 },
    );
  });
});
