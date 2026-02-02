// Utility to sanitize user data based on requester's role and context
// Prevents sharing of personal information like email, phone, payment details

import { IUser } from '../models/User';

export interface SanitizedUser {
  _id: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'employee' | 'cafe';
  // Employee fields (public)
  rating?: number;
  totalReviews?: number;
  // Café fields (public)
  shopName?: string;
  shopAddress?: string;
  cafeRating?: number;
  totalCafeReviews?: number;
}

/**
 * Sanitize user data for public display
 * Removes sensitive information like email, phone, payment details, DOB, CV path, shareCode
 */
export const sanitizeUser = (user: any, requesterRole?: string): SanitizedUser => {
  if (!user) return user;

  const sanitized: any = {
    _id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
  };

  // Add role-specific public fields
  if (user.role === 'employee') {
    sanitized.rating = user.rating;
    sanitized.totalReviews = user.totalReviews;
    // DO NOT include: email, dateOfBirth, cvPath, shareCode
  }

  if (user.role === 'cafe') {
    sanitized.shopName = user.shopName;
    sanitized.shopAddress = user.shopAddress;
    sanitized.cafeRating = user.cafeRating;
    sanitized.totalCafeReviews = user.totalCafeReviews;
    // DO NOT include: email, payment details
  }

  return sanitized;
};

/**
 * Get safe fields to select for populate queries
 * Use this in .populate() calls to only fetch non-sensitive fields
 */
export const getSafeUserFields = (userRole: 'employee' | 'cafe' | 'admin'): string => {
  const baseFields = 'firstName lastName role';
  
  if (userRole === 'employee') {
    return `${baseFields} rating totalReviews`;
  }
  
  if (userRole === 'cafe') {
    return `${baseFields} shopName shopAddress cafeRating totalCafeReviews`;
  }
  
  return baseFields;
};

/**
 * Sanitize an array of users
 */
export const sanitizeUsers = (users: any[], requesterRole?: string): SanitizedUser[] => {
  return users.map(user => sanitizeUser(user, requesterRole));
};
