import {
  BadRequestException, CanActivate, ExecutionContext, Injectable,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { StoreService } from './store.service';

export interface SessionRequest {
  headers: { authorization?: string };
  openid: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly store: StoreService) {}

  async login(payload: { code?: unknown } | null | undefined) {
    if (typeof payload?.code !== 'string' || !payload.code.trim() || payload.code.length > 256) {
      throw new BadRequestException('Invalid login code');
    }
    const appid = process.env.WECHAT_APP_ID;
    const secret = process.env.WECHAT_APP_SECRET;
    if (!appid || !secret) throw new ServiceUnavailableException('微信登录尚未配置');
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.search = new URLSearchParams({ appid, secret, js_code: payload.code, grant_type: 'authorization_code' }).toString();
    let data: { openid?: string; errcode?: number };
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('WeChat HTTP error');
      data = await response.json() as typeof data;
    } catch {
      throw new ServiceUnavailableException('微信登录服务暂时不可用');
    }
    if (data.errcode === -1 || data.errcode === 45011) {
      throw new ServiceUnavailableException('微信登录服务繁忙，请稍后重试');
    }
    if (data.errcode || !data.openid) throw new UnauthorizedException('微信登录失败，请重试');
    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    this.store.saveSession(token, data.openid, expiresAt);
    return { success: true, data: { token, expiresAt } };
  }
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly store: StoreService) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    const token = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const openid = token ? this.store.getSessionOwner(token) : null;
    if (!openid) throw new UnauthorizedException('登录已过期，请重新登录');
    request.openid = openid;
    return true;
  }
}
