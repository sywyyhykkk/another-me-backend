import { Body, Controller, Delete, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthService, SessionGuard } from './auth.service';
import type { SessionRequest } from './auth.service';
import { ProfileService } from './profile.service';
import { GeoService } from './geo.service';
import type { CreateVirtualProfilePayload, DeleteVirtualProfilePayload } from './types';

@Controller()
export class AppController {
  constructor(
    private readonly auth: AuthService,
    private readonly profiles: ProfileService,
    private readonly geo: GeoService,
  ) {}

  @Get('health') health() { return { success: true }; }
  @Post('auth/login') login(@Body() body: { code?: unknown }) { return this.auth.login(body); }

  @UseGuards(SessionGuard)
  @Get('profiles/active')
  getActive(@Req() req: SessionRequest, @Query('forceRefresh') forceRefresh?: string) {
    return this.profiles.getActive(req.openid, forceRefresh === 'true');
  }

  @UseGuards(SessionGuard)
  @Post('profiles')
  create(@Req() req: SessionRequest, @Body() body: CreateVirtualProfilePayload) {
    return this.profiles.create(req.openid, body);
  }

  @UseGuards(SessionGuard)
  @Delete('profiles')
  delete(@Req() req: SessionRequest, @Body() body: DeleteVirtualProfilePayload) {
    return this.profiles.delete(req.openid, body);
  }

  @UseGuards(SessionGuard)
  @Post('geo/origin')
  origin(@Body() body: { latitude: number; longitude: number }) { return this.geo.resolveOrigin(body); }
}
