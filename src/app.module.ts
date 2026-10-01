import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthService, SessionGuard } from './auth.service';
import { StoreService } from './store.service';
import { GeoService } from './geo.service';
import { ProfileService } from './profile.service';

@Module({
  controllers: [AppController],
  providers: [StoreService, AuthService, SessionGuard, GeoService, ProfileService],
})
export class AppModule {}
