const fs = require('fs');
const path = require('path');

function registerAuthHandlers(context) {
    const { ipcMain, dbModule, getCurrentUser, setCurrentUser } = context;

    ipcMain.handle('login', async (event, { username, password }) => {
        try {
            const cleanUsername = (username || '').trim();
            const cleanPassword = (password || '').trim();
            const hashedPassword = dbModule.hashPassword(cleanPassword);
            const row = await dbModule.dbGet(
                'SELECT * FROM admin WHERE LOWER(TRIM(username)) = LOWER(?) AND password = ?',
                [cleanUsername, hashedPassword]
            );

            if (row) {
                await dbModule.logActivity(row.username, 'Login', 'User successfully logged in.');
                setCurrentUser({ id: row.admin_id, username: row.username });

                let pImage = row.profile_image;
                if (pImage && !pImage.startsWith('data:image/') && fs.existsSync(pImage)) {
                    try {
                        const ext = path.extname(pImage).slice(1);
                        const b64 = fs.readFileSync(pImage).toString('base64');
                        pImage = `data:image/${ext};base64,${b64}`;
                    } catch (e) { }
                }

                return {
                    success: true,
                    admin: { id: row.admin_id, username: row.username, profile_image: pImage }
                };
            } else {
                await dbModule.logActivity(cleanUsername || 'unknown', 'Login Failed', 'Invalid username or password attempt.');
                return { success: false, message: 'Invalid username or password' };
            }
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('change-password', async (event, { username, oldPassword, newPassword }) => {
        try {
            const hashedOldPassword = dbModule.hashPassword(oldPassword);
            const hashedNewPassword = dbModule.hashPassword(newPassword);

            const row = await dbModule.dbGet(
                'SELECT * FROM admin WHERE username = ? AND password = ?',
                [username, hashedOldPassword]
            );

            if (row) {
                await dbModule.dbRun(
                    'UPDATE admin SET password = ? WHERE username = ?',
                    [hashedNewPassword, username]
                );
                await dbModule.logActivity(username, 'Password Change', 'Password updated successfully.');
                return { success: true, message: 'Password changed successfully' };
            } else {
                return { success: false, message: 'Current password is incorrect' };
            }
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('recover-password', async (event, data) => {
        try {
            const { code, newPassword } = data;
            const hashedCode = dbModule.hashPassword(code);
            const hashedPassword = dbModule.hashPassword(newPassword);

            const row = await dbModule.dbGet('SELECT * FROM admin WHERE recovery_code = ?', [hashedCode]);
            if (!row) {
                return { success: false, message: 'Invalid recovery code' };
            }

            await dbModule.dbRun('UPDATE admin SET password = ? WHERE admin_id = ?', [hashedPassword, row.admin_id]);
            await dbModule.logActivity(row.username, 'Password Recovered', 'Password reset using recovery code.');
            return { success: true, message: 'Password reset successfully' };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('update-recovery-code', async (event, data) => {
        try {
            const { username, currentPassword, newCode } = data;
            const hashedPassword = dbModule.hashPassword(currentPassword);
            const hashCode = dbModule.hashPassword(newCode);

            const row = await dbModule.dbGet(
                'SELECT * FROM admin WHERE username = ? AND password = ?',
                [username, hashedPassword]
            );

            if (!row) {
                return { success: false, message: 'Incorrect current password' };
            }

            await dbModule.dbRun('UPDATE admin SET recovery_code = ? WHERE username = ?', [hashCode, username]);
            await dbModule.logActivity(username, 'Update Recovery Code', 'Recovery code updated.');
            return { success: true, message: 'Recovery code updated successfully' };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });

    ipcMain.handle('update-profile', async (event, data) => {
        try {
            const { username, newUsername, imagePath } = data;
            let finalImage = imagePath || null;

            // 1. Check if new username is taken
            if (newUsername !== username) {
                const existingUser = await dbModule.dbGet('SELECT * FROM admin WHERE username = ?', [newUsername]);
                if (existingUser) {
                    return { success: false, message: 'Username already taken' };
                }
            }

            // 2. If image is local file path, convert to base64 for network database persistence
            if (imagePath && !imagePath.startsWith('data:image/') && fs.existsSync(imagePath)) {
                try {
                    const ext = path.extname(imagePath).slice(1) || 'png';
                    const b64 = fs.readFileSync(imagePath).toString('base64');
                    finalImage = `data:image/${ext};base64,${b64}`;
                } catch (e) {
                    console.error('Error reading local profile image:', e);
                }
            }

            // 3. Update in Database
            let updateQuery = 'UPDATE admin SET username = ?';
            const params = [newUsername];

            if (finalImage) {
                updateQuery += ', profile_image = ?';
                params.push(finalImage);
            }

            updateQuery += ' WHERE username = ?';
            params.push(username);

            await dbModule.dbRun(updateQuery, params);
            await dbModule.logActivity(newUsername, 'Update Profile', `Profile updated for user: ${newUsername}`);

            return {
                success: true,
                message: 'Profile updated successfully',
                user: { username: newUsername, profile_image: finalImage }
            };
        } catch (err) {
            return { success: false, message: err.message };
        }
    });
}

module.exports = registerAuthHandlers;
