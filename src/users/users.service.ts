import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        status: true,
        userType: true,
        lastLoginAt: true,
        createdAt: true,
        profile: true,
        _count: {
          select: {
            favorites: true,
            savedCalculations: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const profile = await this.prisma.userProfile.upsert({
      where: { userId },
      update: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.city !== undefined && { city: dto.city }),
        ...(dto.preferredLanguage !== undefined && {
          preferredLanguage: dto.preferredLanguage,
        }),
      },
      create: {
        userId,
        firstName: dto.firstName ?? '',
        lastName: dto.lastName ?? '',
        city: dto.city,
        preferredLanguage: dto.preferredLanguage,
      },
    });

    return profile;
  }
}
