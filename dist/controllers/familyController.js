import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbRun, dbAll } from '../db/database.js';
import { calculateExpiryMetrics } from '../services/expiryService.js';
import { checkUserIsPro } from './subscriptionController.js';
import { ensureFreshData, syncToCloudNow } from '../db/cloudSync.js';
export async function getFamilyGroup(req, res) {
    try {
        const userId = req.user.id;
        const requestedGroupId = req.query.familyGroupId;
        // Find family member entry for current user (prefer joined family if non-owner, or requested group)
        let member;
        if (requestedGroupId) {
            member = await dbGet('SELECT id, family_group_id, role FROM family_members WHERE user_id = ? AND family_group_id = ?', [userId, requestedGroupId]);
        }
        else {
            member = await dbGet(`SELECT id, family_group_id, role FROM family_members
         WHERE user_id = ?
         ORDER BY (CASE WHEN role != 'OWNER' THEN 0 ELSE 1 END), created_at DESC`, [userId]);
        }
        if (!member || !member.family_group_id) {
            res.status(404).json({ error: 'No family group found' });
            return;
        }
        const familyGroup = await dbGet('SELECT * FROM family_groups WHERE id = ?', [member.family_group_id]);
        const members = await dbAll(`SELECT fm.*,
              (SELECT COUNT(*) FROM documents WHERE (owner_member_id = fm.id OR (fm.role = 'OWNER' AND user_id = fm.user_id)) AND is_archived = 0) as assigned_count,
              (SELECT COUNT(DISTINCT dp.document_id) FROM document_permissions dp JOIN documents d ON dp.document_id = d.id WHERE dp.shared_with_member_id = fm.id AND d.is_archived = 0) as shared_count,
              ((SELECT COUNT(*) FROM documents WHERE (owner_member_id = fm.id OR (fm.role = 'OWNER' AND user_id = fm.user_id)) AND is_archived = 0) + 
               (SELECT COUNT(DISTINCT dp.document_id) FROM document_permissions dp JOIN documents d ON dp.document_id = d.id WHERE dp.shared_with_member_id = fm.id AND d.is_archived = 0)) as document_count
       FROM family_members fm
       WHERE fm.family_group_id = ?
       ORDER BY (CASE WHEN fm.role = 'OWNER' THEN 0 WHEN fm.role = 'ADMIN' THEN 1 ELSE 2 END), fm.created_at ASC`, [member.family_group_id]);
        // Get documents owned by user OR shared with user in this family
        const familyDocs = await dbAll(`SELECT DISTINCT
         d.id, d.name, d.expiry_date, d.has_no_expiry, d.is_archived, d.document_type_id,
         d.owner_member_id, dt.name as category_name, dt.color as category_color,
         fm.name as owner_name, fm.avatar_color as owner_avatar_color,
         (CASE WHEN d.user_id = ? THEN 'OWNER' ELSE COALESCE(dp.permission_level, 'VIEW') END) as user_permission
       FROM documents d
       LEFT JOIN document_types dt ON d.document_type_id = dt.id
       LEFT JOIN family_members fm ON d.owner_member_id = fm.id
       LEFT JOIN document_permissions dp ON (dp.document_id = d.id AND dp.shared_with_member_id = ?)
       WHERE (d.user_id = ? OR dp.shared_with_member_id = ?)
         AND d.is_archived = 0`, [userId, member.id, userId, member.id]);
        let expiringSoonCount = 0;
        let expiredCount = 0;
        let activeCount = 0;
        const enrichedFamilyDocs = familyDocs.map(doc => {
            const metrics = calculateExpiryMetrics(doc.expiry_date, Boolean(doc.has_no_expiry));
            if (metrics.status === 'EXPIRING_SOON')
                expiringSoonCount++;
            if (metrics.status === 'EXPIRED')
                expiredCount++;
            if (metrics.status === 'ACTIVE' || metrics.status === 'LIFETIME')
                activeCount++;
            return {
                ...doc,
                status: metrics.status,
                daysRemaining: metrics.daysRemaining,
                formattedRemaining: metrics.formattedRemaining
            };
        });
        // Get all shared document permission records in this family
        const sharedPerms = await dbAll(`SELECT 
         dp.id as permission_id,
         dp.document_id,
         dp.shared_with_member_id,
         dp.permission_level,
         dp.granted_by_user_id,
         dp.created_at as shared_at,
         d.name as document_name,
         d.expiry_date,
         d.has_no_expiry,
         d.document_type_id,
         d.user_id as document_owner_user_id,
         dt.name as category_name,
         dt.color as category_color,
         fm.name as shared_with_name,
         fm.relationship as shared_with_relationship,
         fm.avatar_color as shared_with_avatar_color,
         fm.user_id as shared_with_user_id,
         COALESCE(grantor_p.full_name, 'Family Owner') as shared_by_name
       FROM document_permissions dp
       JOIN documents d ON dp.document_id = d.id
       LEFT JOIN document_types dt ON d.document_type_id = dt.id
       JOIN family_members fm ON dp.shared_with_member_id = fm.id
       LEFT JOIN users grantor_u ON dp.granted_by_user_id = grantor_u.id
       LEFT JOIN profiles grantor_p ON grantor_u.id = grantor_p.user_id
       WHERE fm.family_group_id = ? AND d.is_archived = 0
       ORDER BY dp.created_at DESC`, [member.family_group_id]);
        const enrichedSharedPerms = sharedPerms.map(sp => {
            const metrics = calculateExpiryMetrics(sp.expiry_date, Boolean(sp.has_no_expiry));
            return {
                ...sp,
                status: metrics.status,
                daysRemaining: metrics.daysRemaining,
                formattedRemaining: metrics.formattedRemaining,
                isSharedByMe: sp.granted_by_user_id === userId,
                isSharedWithMe: sp.shared_with_member_id === member.id || sp.shared_with_user_id === userId
            };
        });
        // Get pending invitations sent by this family
        const sentInvitations = await dbAll(`SELECT fi.*, p.full_name as inviter_name
       FROM family_invitations fi
       LEFT JOIN profiles p ON fi.invited_by_user_id = p.user_id
       WHERE fi.family_group_id = ? AND fi.status = 'PENDING' AND fi.expires_at > CURRENT_TIMESTAMP`, [member.family_group_id]);
        res.json({
            familyGroup,
            members,
            currentUserMemberId: member.id,
            currentUserRole: member.role,
            summary: {
                totalDocuments: enrichedFamilyDocs.length,
                expiringSoon: expiringSoonCount,
                expired: expiredCount,
                active: activeCount
            },
            documents: enrichedFamilyDocs,
            sharedPermissions: enrichedSharedPerms,
            pendingInvitations: sentInvitations
        });
    }
    catch (error) {
        console.error('getFamilyGroup error:', error);
        res.status(500).json({ error: 'Failed to fetch family group', details: error.message });
    }
}
export async function updateFamilyGroupName(req, res) {
    try {
        const userId = req.user.id;
        const { name } = req.body;
        if (!name || typeof name !== 'string' || name.trim() === '') {
            res.status(400).json({ error: 'Family group name is required' });
            return;
        }
        const member = await dbGet('SELECT family_group_id, role FROM family_members WHERE user_id = ?', [userId]);
        if (!member || (member.role !== 'OWNER' && member.role !== 'ADMIN')) {
            res.status(403).json({ error: 'Only family owners and admins can rename the family group' });
            return;
        }
        await dbRun('UPDATE family_groups SET name = ? WHERE id = ?', [name.trim(), member.family_group_id]);
        res.json({ message: 'Family group renamed successfully', name: name.trim() });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update family group', details: error.message });
    }
}
export async function addFamilyMember(req, res) {
    try {
        const userId = req.user.id;
        const { name, email, relationship, role, avatarColor } = req.body;
        if (!name || typeof name !== 'string' || name.trim() === '') {
            res.status(400).json({ error: 'Member name is required' });
            return;
        }
        if (!relationship || typeof relationship !== 'string') {
            res.status(400).json({ error: 'Relationship is required (e.g. Spouse, Child, Parent)' });
            return;
        }
        // Check Pro Subscription for family members
        const isPro = await checkUserIsPro(userId);
        const selfMember = await dbGet('SELECT family_group_id, role FROM family_members WHERE user_id = ?', [userId]);
        if (!selfMember) {
            res.status(400).json({ error: 'User does not belong to a family group' });
            return;
        }
        // Count existing members
        const countRow = await dbGet('SELECT COUNT(*) as count FROM family_members WHERE family_group_id = ?', [selfMember.family_group_id]);
        const memberCount = countRow?.count || 1;
        // Free plan allows owner + up to 2 family members (total 3 members in group)
        if (!isPro && memberCount >= 3) {
            res.status(403).json({
                error: 'Free plan includes up to 2 family members. Upgrade to Document Vault Pro for unlimited family sharing.',
                code: 'FAMILY_PRO_REQUIRED'
            });
            return;
        }
        const memberId = uuidv4();
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#14b8a6'];
        const selectedColor = avatarColor || colors[Math.floor(Math.random() * colors.length)];
        let invitationId = uuidv4();
        const inviteCode = 'FAM-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        let memberStatus = email ? 'PENDING' : 'ACTIVE';
        let targetUserId = null;
        let normalizedEmail = null;
        if (email && typeof email === 'string' && email.includes('@')) {
            normalizedEmail = email.toLowerCase().trim();
            // Check if user already exists in this family group
            const existingInFamily = await dbGet('SELECT id FROM family_members WHERE family_group_id = ? AND (email = ? OR user_id IN (SELECT id FROM users WHERE email = ?))', [selfMember.family_group_id, normalizedEmail, normalizedEmail]);
            if (existingInFamily) {
                res.status(400).json({ error: 'A member with this email is already in your family group' });
                return;
            }
            const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
            targetUserId = existingUser?.id || null;
        }
        // Always create a pending family invitation code so the member can join anytime
        await dbRun(`INSERT INTO family_invitations (
        id, family_group_id, invited_by_user_id, invitee_email, invitee_user_id,
        invite_code, relationship, role, status, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`, [
            invitationId,
            selfMember.family_group_id,
            userId,
            normalizedEmail || `${name.trim().toLowerCase().replace(/\s+/g, '_')}@family.local`,
            targetUserId,
            inviteCode,
            relationship.trim(),
            role || 'MEMBER',
            expiresAt
        ]);
        await dbRun(`INSERT INTO family_members (id, family_group_id, user_id, name, email, relationship, role, avatar_color, status, invitation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            memberId,
            selfMember.family_group_id,
            targetUserId,
            name.trim(),
            normalizedEmail,
            relationship.trim(),
            role || 'MEMBER',
            selectedColor,
            memberStatus,
            invitationId
        ]);
        await dbRun('INSERT INTO activity_history (id, user_id, action_type, description) VALUES (?, ?, ?, ?)', [uuidv4(), userId, 'SHARED', `Added family member ${name.trim()} (${relationship.trim()})`]);
        // Synchronize to cloud immediately
        await syncToCloudNow();
        res.status(201).json({
            message: email
                ? `Family member added and invitation code ${inviteCode} generated for ${email.trim()}!`
                : `Family vault member ${name.trim()} added successfully! Invite Code: ${inviteCode}`,
            memberId,
            status: memberStatus,
            invitationId,
            inviteCode,
            isLocalProfile: !email,
            name: name.trim(),
            relationship: relationship.trim(),
            email: normalizedEmail
        });
    }
    catch (error) {
        console.error('addFamilyMember error:', error);
        res.status(500).json({ error: 'Failed to add family member', details: error.message });
    }
}
export async function joinFamilyByCode(req, res) {
    try {
        await ensureFreshData(true);
        const userId = req.user.id;
        const userEmail = req.user.email;
        const userName = req.user.fullName;
        const { code } = req.body;
        if (!code || typeof code !== 'string') {
            res.status(400).json({ error: 'Family invite code is required' });
            return;
        }
        const cleanCode = code.trim().toUpperCase();
        // Check invitation by code or ID (case-insensitive)
        const invitation = await dbGet(`SELECT fi.*, fg.name as family_name 
       FROM family_invitations fi 
       JOIN family_groups fg ON fi.family_group_id = fg.id 
       WHERE (UPPER(fi.invite_code) = ? OR UPPER(fi.id) = ?) AND fi.status = 'PENDING'`, [cleanCode, cleanCode]);
        if (!invitation) {
            res.status(404).json({ error: 'Invalid or expired invitation code. Please check with your family vault owner.' });
            return;
        }
        if (new Date(invitation.expires_at).getTime() < Date.now()) {
            res.status(400).json({ error: 'This invitation code has expired' });
            return;
        }
        // Check if member row already existed for this invitation
        const existingMember = await dbGet('SELECT id FROM family_members WHERE invitation_id = ? OR (family_group_id = ? AND (LOWER(email) = ? OR user_id = ?))', [invitation.id, invitation.family_group_id, userEmail.toLowerCase(), userId]);
        if (existingMember) {
            await dbRun('UPDATE family_members SET user_id = ?, name = ?, email = ?, status = "ACTIVE" WHERE id = ?', [userId, userName || 'Family Member', userEmail.toLowerCase(), existingMember.id]);
        }
        else {
            const memberId = uuidv4();
            await dbRun(`INSERT INTO family_members (id, family_group_id, user_id, name, email, relationship, role, avatar_color, status, invitation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, '#3b82f6', 'ACTIVE', ?)`, [
                memberId,
                invitation.family_group_id,
                userId,
                userName || 'Family Member',
                userEmail.toLowerCase(),
                invitation.relationship || 'Family Member',
                invitation.role || 'MEMBER',
                invitation.id
            ]);
        }
        // Update invitation status
        await dbRun('UPDATE family_invitations SET status = "ACCEPTED", invitee_user_id = ?, invitee_email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [userId, userEmail.toLowerCase(), invitation.id]);
        await dbRun('INSERT INTO activity_history (id, user_id, action_type, description) VALUES (?, ?, ?, ?)', [uuidv4(), userId, 'UPDATED', `Joined ${invitation.family_name} via invite code`]);
        // Sync cloud database immediately
        await syncToCloudNow();
        res.json({ message: `Successfully joined ${invitation.family_name}!`, familyName: invitation.family_name });
    }
    catch (error) {
        console.error('joinFamilyByCode error:', error);
        res.status(500).json({ error: 'Failed to join family vault', details: error.message });
    }
}
export async function updateFamilyMember(req, res) {
    try {
        const memberId = req.params.id;
        const userId = req.user.id;
        const { name, relationship, avatarColor } = req.body;
        if (!name || typeof name !== 'string') {
            res.status(400).json({ error: 'Member name is required' });
            return;
        }
        // Verify caller is owner/admin of the member's family group
        const callerMember = await dbGet('SELECT id, role, family_group_id FROM family_members WHERE user_id = ?', [userId]);
        if (!callerMember || (callerMember.role !== 'OWNER' && callerMember.role !== 'ADMIN')) {
            res.status(403).json({ error: 'Permission denied: Only family owners or admins can update family members' });
            return;
        }
        const targetMember = await dbGet('SELECT id, family_group_id FROM family_members WHERE id = ?', [memberId]);
        if (!targetMember || targetMember.family_group_id !== callerMember.family_group_id) {
            res.status(404).json({ error: 'Family member not found in your family group' });
            return;
        }
        await dbRun('UPDATE family_members SET name = ?, relationship = ?, avatar_color = COALESCE(?, avatar_color) WHERE id = ?', [name.trim(), relationship ? relationship.trim() : 'Family Member', avatarColor || null, memberId]);
        res.json({ message: 'Family member updated successfully' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update family member', details: error.message });
    }
}
export async function deleteFamilyMember(req, res) {
    try {
        const memberId = req.params.id;
        const userId = req.user.id;
        // Verify caller is owner/admin
        const selfMember = await dbGet('SELECT id, role, family_group_id FROM family_members WHERE user_id = ?', [userId]);
        if (!selfMember || (selfMember.role !== 'OWNER' && selfMember.role !== 'ADMIN')) {
            res.status(403).json({ error: 'Permission denied: Only family owners or admins can remove members' });
            return;
        }
        const memberToDelete = await dbGet('SELECT id, invitation_id FROM family_members WHERE id = ?', [memberId]);
        // Clean up document permissions shared with this member
        await dbRun('DELETE FROM document_permissions WHERE shared_with_member_id = ?', [memberId]);
        // Unlink documents owned by this member (reset owner_member_id to null or self)
        await dbRun('UPDATE documents SET owner_member_id = ? WHERE owner_member_id = ?', [selfMember.id, memberId]);
        if (memberToDelete?.invitation_id) {
            await dbRun('DELETE FROM family_invitations WHERE id = ?', [memberToDelete.invitation_id]);
        }
        // Remove member row
        await dbRun('DELETE FROM family_members WHERE id = ? AND family_group_id = ?', [memberId, selfMember.family_group_id]);
        await syncToCloudNow();
        res.json({ message: 'Family member removed successfully' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to remove family member', details: error.message });
    }
}
export async function inviteFamilyMember(req, res) {
    try {
        const userId = req.user.id;
        const { email, relationship, role } = req.body;
        if (!email || typeof email !== 'string' || !email.includes('@')) {
            res.status(400).json({ error: 'Valid email address is required for invitation' });
            return;
        }
        const selfMember = await dbGet('SELECT family_group_id, role FROM family_members WHERE user_id = ?', [userId]);
        if (!selfMember || (selfMember.role !== 'OWNER' && selfMember.role !== 'ADMIN')) {
            res.status(403).json({ error: 'Only family owners and admins can send invitations' });
            return;
        }
        const isPro = await checkUserIsPro(userId);
        const countRow = await dbGet('SELECT COUNT(*) as count FROM family_members WHERE family_group_id = ?', [selfMember.family_group_id]);
        const memberCount = countRow?.count || 1;
        if (!isPro && memberCount >= 3) {
            res.status(403).json({
                error: 'Free plan includes up to 2 family members. Upgrade to Document Vault Pro for unlimited family sharing.',
                code: 'FAMILY_PRO_REQUIRED'
            });
            return;
        }
        // Check if invitee is already in this family
        const normalizedEmail = email.toLowerCase().trim();
        const existingUser = await dbGet('SELECT u.id, p.full_name FROM users u LEFT JOIN profiles p ON u.id = p.user_id WHERE u.email = ?', [normalizedEmail]);
        if (existingUser) {
            const alreadyMember = await dbGet('SELECT id FROM family_members WHERE family_group_id = ? AND (user_id = ? OR email = ?)', [selfMember.family_group_id, existingUser.id, normalizedEmail]);
            if (alreadyMember) {
                res.status(400).json({ error: 'This user is already a member of your family group' });
                return;
            }
        }
        // Create Invitation (30-day expiry)
        const invitationId = uuidv4();
        const inviteCode = 'FAM-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        await dbRun(`INSERT INTO family_invitations (
        id, family_group_id, invited_by_user_id, invitee_email, invitee_user_id,
        invite_code, relationship, role, status, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`, [
            invitationId,
            selfMember.family_group_id,
            userId,
            normalizedEmail,
            existingUser?.id || null,
            inviteCode,
            relationship || 'Family Member',
            role || 'MEMBER',
            expiresAt
        ]);
        const memberId = uuidv4();
        await dbRun(`INSERT INTO family_members (id, family_group_id, user_id, name, email, relationship, role, avatar_color, status, invitation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, '#3b82f6', 'PENDING', ?)`, [
            memberId,
            selfMember.family_group_id,
            existingUser?.id || null,
            existingUser?.full_name || normalizedEmail.split('@')[0],
            normalizedEmail,
            relationship || 'Family Member',
            role || 'MEMBER',
            invitationId
        ]);
        await syncToCloudNow();
        res.status(201).json({
            message: `Invitation sent to ${email} (Invite Code: ${inviteCode})`,
            invitationId,
            inviteCode,
            expiresAt
        });
    }
    catch (error) {
        console.error('inviteFamilyMember error:', error);
        res.status(500).json({ error: 'Failed to send invitation', details: error.message });
    }
}
export async function getPendingInvitations(req, res) {
    try {
        const userEmail = req.user.email;
        const invitations = await dbAll(`SELECT fi.*, fg.name as family_name, p.full_name as inviter_name, u.email as inviter_email
       FROM family_invitations fi
       JOIN family_groups fg ON fi.family_group_id = fg.id
       JOIN users u ON fi.invited_by_user_id = u.id
       LEFT JOIN profiles p ON u.id = p.user_id
       WHERE fi.invitee_email = ? AND fi.status = 'PENDING' AND fi.expires_at > CURRENT_TIMESTAMP`, [userEmail.toLowerCase()]);
        res.json({ invitations });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch invitations', details: error.message });
    }
}
export async function acceptInvitation(req, res) {
    try {
        const invitationId = req.params.id;
        const userId = req.user.id;
        const userEmail = req.user.email;
        const userName = req.user.fullName;
        const invitation = await dbGet('SELECT * FROM family_invitations WHERE id = ? AND invitee_email = ? AND status = "PENDING"', [invitationId, userEmail.toLowerCase()]);
        if (!invitation) {
            res.status(404).json({ error: 'Invitation not found, already processed, or expired' });
            return;
        }
        if (new Date(invitation.expires_at).getTime() < Date.now()) {
            res.status(400).json({ error: 'This invitation has expired' });
            return;
        }
        // Check if member row already existed for this invitation
        const existingMember = await dbGet('SELECT id FROM family_members WHERE invitation_id = ? OR (family_group_id = ? AND email = ?)', [invitationId, invitation.family_group_id, userEmail.toLowerCase()]);
        if (existingMember) {
            await dbRun('UPDATE family_members SET user_id = ?, name = ?, status = "ACTIVE" WHERE id = ?', [userId, userName || 'Family Member', existingMember.id]);
        }
        else {
            const memberId = uuidv4();
            await dbRun(`INSERT INTO family_members (id, family_group_id, user_id, name, email, relationship, role, avatar_color, status, invitation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, '#3b82f6', 'ACTIVE', ?)`, [
                memberId,
                invitation.family_group_id,
                userId,
                userName || 'Family Member',
                userEmail.toLowerCase(),
                invitation.relationship || 'Family Member',
                invitation.role || 'MEMBER',
                invitationId
            ]);
        }
        // Update invitation status
        await dbRun('UPDATE family_invitations SET status = "ACCEPTED", invitee_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [userId, invitationId]);
        await dbRun('INSERT INTO activity_history (id, user_id, action_type, description) VALUES (?, ?, ?, ?)', [uuidv4(), userId, 'UPDATED', `Accepted family invitation from ${invitation.invited_by_user_id}`]);
        await syncToCloudNow();
        res.json({ message: 'Invitation accepted! You have joined the family vault.' });
    }
    catch (error) {
        console.error('acceptInvitation error:', error);
        res.status(500).json({ error: 'Failed to accept invitation', details: error.message });
    }
}
export async function rejectInvitation(req, res) {
    try {
        const invitationId = req.params.id;
        const userEmail = req.user.email;
        await dbRun('UPDATE family_invitations SET status = "REJECTED", updated_at = CURRENT_TIMESTAMP WHERE id = ? AND invitee_email = ?', [invitationId, userEmail.toLowerCase()]);
        await dbRun('UPDATE family_members SET status = "REJECTED" WHERE invitation_id = ?', [invitationId]);
        await syncToCloudNow();
        res.json({ message: 'Invitation declined' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to reject invitation', details: error.message });
    }
}
export async function cancelInvitation(req, res) {
    try {
        const invitationId = req.params.id;
        const userId = req.user.id;
        const selfMember = await dbGet('SELECT family_group_id, role FROM family_members WHERE user_id = ?', [userId]);
        if (!selfMember || (selfMember.role !== 'OWNER' && selfMember.role !== 'ADMIN')) {
            res.status(403).json({ error: 'Permission denied: Only family owners and admins can cancel invitations' });
            return;
        }
        await dbRun('UPDATE family_invitations SET status = "CANCELLED", updated_at = CURRENT_TIMESTAMP WHERE id = ? AND family_group_id = ?', [invitationId, selfMember.family_group_id]);
        await dbRun('DELETE FROM family_members WHERE invitation_id = ? AND status = "PENDING"', [invitationId]);
        await syncToCloudNow();
        res.json({ message: 'Invitation cancelled successfully' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to cancel invitation', details: error.message });
    }
}
export async function leaveFamily(req, res) {
    try {
        const userId = req.user.id;
        const { familyGroupId } = req.body || {};
        // Find member record where user is NOT owner (or specific family group)
        let member;
        if (familyGroupId) {
            member = await dbGet('SELECT id, role, family_group_id FROM family_members WHERE user_id = ? AND family_group_id = ?', [userId, familyGroupId]);
        }
        else {
            member = await dbGet('SELECT id, role, family_group_id FROM family_members WHERE user_id = ? AND role != "OWNER"', [userId]);
        }
        if (!member) {
            res.status(400).json({ error: 'No joined family group found to leave' });
            return;
        }
        if (member.role === 'OWNER') {
            res.status(400).json({ error: 'Family owners cannot leave the family. Delete the family group or transfer ownership first.' });
            return;
        }
        // Revoke document permissions granted to or by this member in this family
        await dbRun('DELETE FROM document_permissions WHERE shared_with_member_id = ? OR granted_by_user_id = ?', [member.id, userId]);
        // Remove membership
        await dbRun('DELETE FROM family_members WHERE id = ?', [member.id]);
        await syncToCloudNow();
        res.json({ message: 'You have left the family group' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to leave family group', details: error.message });
    }
}
export async function deleteFamilyGroup(req, res) {
    try {
        const userId = req.user.id;
        const selfMember = await dbGet('SELECT id, role, family_group_id FROM family_members WHERE user_id = ?', [userId]);
        if (!selfMember || selfMember.role !== 'OWNER') {
            res.status(403).json({ error: 'Permission denied: Only the family owner can delete the family group' });
            return;
        }
        // Unlink family group from documents
        await dbRun('UPDATE documents SET family_group_id = NULL WHERE family_group_id = ?', [selfMember.family_group_id]);
        // Clean up document permissions
        await dbRun(`DELETE FROM document_permissions WHERE document_id IN (SELECT id FROM documents WHERE user_id = ?)`, [userId]);
        // Delete family members (except primary owner profile)
        await dbRun('DELETE FROM family_members WHERE family_group_id = ? AND user_id != ?', [selfMember.family_group_id, userId]);
        // Delete family group record
        await dbRun('DELETE FROM family_groups WHERE id = ?', [selfMember.family_group_id]);
        await syncToCloudNow();
        res.json({ message: 'Family group deleted successfully' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete family group', details: error.message });
    }
}
export async function shareDocumentWithMember(req, res) {
    try {
        const userId = req.user.id;
        const documentId = req.body.documentId || req.body.document_id;
        const memberId = req.body.memberId || req.body.member_id;
        const permissionLevel = req.body.permissionLevel || req.body.permission_level;
        if (!documentId || !memberId) {
            res.status(400).json({ error: 'Document ID and Family Member ID are required' });
            return;
        }
        const level = (permissionLevel === 'EDIT' ? 'EDIT' : 'VIEW');
        // Verify current user owns document or is family owner
        const doc = await dbGet('SELECT id, user_id, name FROM documents WHERE id = ?', [documentId]);
        if (!doc || doc.user_id !== userId) {
            res.status(403).json({ error: 'Only the document owner can share this document' });
            return;
        }
        const existingPerm = await dbGet('SELECT id FROM document_permissions WHERE document_id = ? AND shared_with_member_id = ?', [documentId, memberId]);
        if (existingPerm) {
            await dbRun('UPDATE document_permissions SET permission_level = ?, granted_by_user_id = ? WHERE id = ?', [level, userId, existingPerm.id]);
        }
        else {
            await dbRun('INSERT INTO document_permissions (id, document_id, shared_with_member_id, permission_level, granted_by_user_id) VALUES (?, ?, ?, ?, ?)', [uuidv4(), documentId, memberId, level, userId]);
        }
        // Log activity
        await dbRun('INSERT INTO activity_history (id, document_id, user_id, action_type, description) VALUES (?, ?, ?, ?, ?)', [uuidv4(), documentId, userId, 'SHARED', `Shared document "${doc.name}" (${level} access)`]);
        res.json({ message: `Document shared with member (${level} permission)` });
    }
    catch (error) {
        console.error('shareDocumentWithMember error:', error);
        res.status(500).json({ error: 'Failed to share document', details: error.message });
    }
}
export async function unshareDocumentFromMember(req, res) {
    try {
        const userId = req.user.id;
        const documentId = req.body.documentId || req.body.document_id;
        const memberId = req.body.memberId || req.body.member_id;
        if (!documentId || !memberId) {
            res.status(400).json({ error: 'Document ID and Member ID are required' });
            return;
        }
        // Verify current user owns document
        const doc = await dbGet('SELECT id, user_id FROM documents WHERE id = ?', [documentId]);
        if (!doc || doc.user_id !== userId) {
            res.status(403).json({ error: 'Only the document owner can modify sharing permissions' });
            return;
        }
        await dbRun('DELETE FROM document_permissions WHERE document_id = ? AND shared_with_member_id = ?', [documentId, memberId]);
        res.json({ message: 'Document access revoked for member' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to revoke access', details: error.message });
    }
}
