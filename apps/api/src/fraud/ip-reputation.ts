import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type IpVerdict = { vpn: boolean; proxy: boolean; fraudScore: number };

// ponytail: mock IPQualityScore. If IPQS_API_KEY is set, call the real API;
// otherwise flag IPs listed in FRAUD_BLOCKED_IPS (comma-separated). Deterministic
// so tests can force a "VPN" hit.
@Injectable()
export class IpReputationService {
  private readonly log = new Logger(IpReputationService.name);
  private readonly blocked: Set<string>;

  constructor(private readonly config: ConfigService) {
    this.blocked = new Set(
      (config.get<string>('FRAUD_BLOCKED_IPS', '') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  async check(ip: string | null | undefined): Promise<IpVerdict> {
    if (!ip) return { vpn: false, proxy: false, fraudScore: 0 };

    const apiKey = this.config.get<string>('IPQS_API_KEY');
    if (apiKey) {
      // ponytail: real integration goes here — GET ipqualityscore.com/api/json/ip/<key>/<ip>
      this.log.warn('IPQS_API_KEY set but real lookup not wired; using mock');
    }

    const flagged = this.blocked.has(ip);
    return { vpn: flagged, proxy: flagged, fraudScore: flagged ? 90 : 0 };
  }
}
