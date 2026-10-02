import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthService, SessionGuard } from './auth.service';
import { StoreService } from './store.service';
import { GeoService } from './geo.service';
import { ProfileService } from './profile.service';
import { WeatherService } from './weather.service';

@Module({
  controllers: [AppController],
  providers: [StoreService, AuthService, SessionGuard, GeoService, WeatherService, ProfileService],
})
export class AppModule {}
