import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { MongoRepository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private locked = false;

  constructor(
    @InjectRepository(User)
    private readonly users: MongoRepository<User>,
    private readonly jwt: JwtService,
  ) {}

  async isLocked(): Promise<boolean> {
    if (this.locked) return true;
    this.locked = (await this.users.count()) > 0;
    return this.locked;
  }

  async register(dto: RegisterDto) {
    if (await this.isLocked()) {
      throw new ConflictException('This instance is already locked.');
    }
    const email = dto.email.toLowerCase().trim();
    const password = await bcrypt.hash(dto.password, 10);
    const user = await this.users.save(this.users.create({ email, password }));
    this.locked = true;
    return this.issueToken(user);
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase().trim();
    const user = await this.users.findOneBy({ email });
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    return this.issueToken(user);
  }

  private issueToken(user: User) {
    const sub = user.id.toString();
    return {
      accessToken: this.jwt.sign({ sub, email: user.email }),
      user: { id: sub, email: user.email },
    };
  }
}
