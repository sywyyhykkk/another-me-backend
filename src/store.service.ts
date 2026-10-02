import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ShareSnapshot, VirtualProfile } from './types';

@Injectable()
export class StoreService implements OnModuleDestroy {
  private readonly db: DatabaseSync;

  constructor() {
    const path = process.env.DATABASE_PATH || './data/another-me.sqlite';
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, openid TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY, openid TEXT NOT NULL, status TEXT NOT NULL,
        updated_at TEXT NOT NULL, document TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS profiles_owner ON profiles(openid, status, updated_at);
      CREATE UNIQUE INDEX IF NOT EXISTS profiles_active ON profiles(openid) WHERE status = 'active';
      CREATE TABLE IF NOT EXISTS share_snapshots (id TEXT PRIMARY KEY, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS geo_cache (id TEXT PRIMARY KEY, document TEXT NOT NULL);
    `);
  }

  onModuleDestroy() { this.db.close(); }

  saveSession(token: string, openid: string, expiresAt: number) {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(token, openid, expiresAt);
  }

  getSessionOwner(token: string): string | null {
    const row = this.db.prepare('SELECT openid FROM sessions WHERE token = ? AND expires_at > ?')
      .get(token, Date.now());
    return row ? String(row.openid) : null;
  }

  getActiveProfile(openid: string): VirtualProfile | null {
    const row = this.db.prepare("SELECT document FROM profiles WHERE openid = ? AND status = 'active'")
      .get(openid);
    return row ? JSON.parse(String(row.document)) : null;
  }

  createProfile(document: Omit<VirtualProfile, '_id'> & { openid: string }): VirtualProfile {
    const profile = { _id: randomUUID(), ...document };
    this.transaction(() => {
      const active = this.getActiveProfile(document.openid);
      if (active) this.updateProfile({ ...active, profileStatus: 'archived', updatedAt: document.updatedAt });
      this.db.prepare('INSERT INTO profiles VALUES (?, ?, ?, ?, ?)')
        .run(profile._id, document.openid, 'active', String(document.updatedAt), JSON.stringify(profile));
    });
    return profile;
  }

  updateProfile(profile: VirtualProfile) {
    return this.db.prepare('UPDATE profiles SET status = ?, updated_at = ?, document = ? WHERE id = ? AND openid = ?')
      .run(profile.profileStatus, String(profile.updatedAt), JSON.stringify(profile), profile._id, profile.openid!).changes > 0;
  }

  deleteProfile(openid: string, profileId: string): boolean {
    let deleted = false;
    this.transaction(() => {
      const active = this.getActiveProfile(openid);
      deleted = this.db.prepare('DELETE FROM profiles WHERE id = ? AND openid = ?').run(profileId, openid).changes > 0;
      if (deleted && active?._id === profileId) {
        const row = this.db.prepare('SELECT document FROM profiles WHERE openid = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1')
          .get(openid);
        if (row) this.updateProfile({ ...JSON.parse(String(row.document)), profileStatus: 'active', updatedAt: new Date().toISOString() });
      }
    });
    return deleted;
  }

  createShare(content: Omit<ShareSnapshot, 'id'>): ShareSnapshot {
    const snapshot = { id: randomUUID(), ...content };
    this.db.prepare('INSERT INTO share_snapshots VALUES (?, ?)').run(snapshot.id, JSON.stringify(snapshot));
    return snapshot;
  }

  getShare(id: string): ShareSnapshot | null {
    const row = this.db.prepare('SELECT document FROM share_snapshots WHERE id = ?').get(id);
    return row ? JSON.parse(String(row.document)) : null;
  }

  getGeoCache<T>(id: string): T | null {
    const row = this.db.prepare('SELECT document FROM geo_cache WHERE id = ?').get(id);
    return row ? JSON.parse(String(row.document)) : null;
  }

  saveGeoCache(id: string, data: unknown) {
    this.db.prepare('INSERT OR REPLACE INTO geo_cache VALUES (?, ?)').run(id, JSON.stringify(data));
  }

  private transaction(action: () => void) {
    this.db.exec('BEGIN');
    try { action(); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
