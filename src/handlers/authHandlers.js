const fs = require('fs');
const path = require('path');

function registerAuthHandlers(context) {
    const { ipcMain, dbModule, getCurrentUser, setCurrentUser } = context;

    ipcMain.handle('login', async (event, { username, password }) => {
        return new Promise((resolve, reject) => {
            const hashedPassword = dbModule.hashPassword(password);
            dbModule.db.get('SELECT * FROM admin WHERE username = ? AND password = ?',
                [username, hashedPassword],
                (err, row) => {
                    if (err) {
                        reject({ success: false, message: err.message });
                    } else if (row) {
                        dbModule.logActivity(username, 'Login', 'User successfully logged in.');
                        setCurrentUser({ id: row.admin_id, username: row.username });
                        let pImage = row.profile_image;
                        if (pImage && fs.existsSync(pImage)) {
                            try {
                                const ext = path.extname(pImage).slice(1);
                                const b64 = fs.readFileSync(pImage).toString('base64');
                                pImage = `data:image/${ext};base64,${b64}`;
                            } catch (e) { }
                        }
                        resolve({ success: true, admin: { id: row.admin_id, username: row.username, profile_image: pImage } });
                    } else {
                        dbModule.logActivity(username, 'Login Failed', 'Invalid username or password attempt.');
                        resolve({ success: false, message: 'Invalid username or password' });
                    }
                }
            );
        });
    });

    ipcMain.handle('change-password', async (event, { username, oldPassword, newPassword }) => {
        return new Promise((resolve, reject) => {
            const hashedOldPassword = dbModule.hashPassword(oldPassword);
            const hashedNewPassword = dbModule.hashPassword(newPassword);

            dbModule.db.get('SELECT * FROM admin WHERE username = ? AND password = ?',
                [username, hashedOldPassword],
                (err, row) => {
                    if (err) {
                        reject({ success: false, message: err.message });
                    } else if (row) {
                        dbModule.db.run('UPDATE admin SET password = ? WHERE username = ?',
                            [hashedNewPassword, username],
                            (err) => {
                                if (err) {
                                    reject({ success: false, message: err.message });
                                } else {
                                    resolve({ success: true, message: 'Password changed successfully' });
                                }
                            }
                        );
                    } else {
                        resolve({ success: false, message: 'Current password is incorrect' });
                    }
                }
            );
        });
    });

    ipcMain.handle('recover-password', async (event, data) => {
        return new Promise((resolve, reject) => {
            const { code, newPassword } = data;
            const hashedCode = dbModule.hashPassword(code);
            const hashedPassword = dbModule.hashPassword(newPassword);

            dbModule.db.get('SELECT * FROM admin WHERE recovery_code = ?', [hashedCode], (err, row) => {
                if (err) {
                    resolve({ success: false, message: err.message });
                } else if (!row) {
                    resolve({ success: false, message: 'Invalid recovery code' });
                } else {
                    dbModule.db.run('UPDATE admin SET password = ? WHERE admin_id = ?', [hashedPassword, row.admin_id], (err) => {
                        if (err) {
                            resolve({ success: false, message: err.message });
                        } else {
                            resolve({ success: true, message: 'Password reset successfully' });
                        }
                    });
                }
            });
        });
    });

    ipcMain.handle('update-recovery-code', async (event, data) => {
        return new Promise((resolve, reject) => {
            const { username, currentPassword, newCode } = data;
            const hashedPassword = dbModule.hashPassword(currentPassword);
            const hashCode = dbModule.hashPassword(newCode);

            // Verify current password first
            dbModule.db.get('SELECT * FROM admin WHERE username = ? AND password = ?', [username, hashedPassword], (err, row) => {
                if (err) {
                    resolve({ success: false, message: err.message });
                } else if (!row) {
                    resolve({ success: false, message: 'Incorrect current password' });
                } else {
                    dbModule.db.run('UPDATE admin SET recovery_code = ? WHERE username = ?', [hashCode, username], (err) => {
                        if (err) {
                            resolve({ success: false, message: err.message });
                        } else {
                            resolve({ success: true, message: 'Recovery code updated successfully' });
                        }
                    });
                }
            });
        });
    });

    ipcMain.handle('update-profile', async (event, data) => {
        const { app } = context;
        return new Promise(async (resolve, reject) => {
            const { username, newUsername, imagePath } = data;
            let finalImagePath = null;

            // 1. Check if new username is taken (if changed)
            if (newUsername !== username) {
                const checkQuery = 'SELECT * FROM admin WHERE username = ?';
                const existingUser = await new Promise((res) => {
                    dbModule.db.get(checkQuery, [newUsername], (err, row) => res(row));
                });

                if (existingUser) {
                    return reject({ success: false, message: 'Username already taken' });
                }
            }

            // 2. Handle Image Upload
            if (imagePath) {
                try {
                    const userDataPath = app.getPath('userData');
                    const profilesDir = path.join(userDataPath, 'profiles');
                    if (!fs.existsSync(profilesDir)) {
                        fs.mkdirSync(profilesDir, { recursive: true });
                    }

                    if (imagePath.startsWith('data:image/')) {
                        const matches = imagePath.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
                        if (matches && matches.length === 3) {
                            const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
                            const fileName = `profile_${new Date().getTime()}.${ext}`;
                            finalImagePath = path.join(profilesDir, fileName);
                            const buffer = Buffer.from(matches[2], 'base64');
                            fs.writeFileSync(finalImagePath, buffer);
                        }
                    } else if (imagePath && typeof imagePath === 'string' && fs.existsSync(imagePath)) {
                        const ext = path.extname(imagePath);
                        const fileName = `profile_${new Date().getTime()}${ext}`;
                        finalImagePath = path.join(profilesDir, fileName);
                        await fs.promises.copyFile(imagePath, finalImagePath);
                    } else {
                        console.error('Invalid imagePath provided');
                    }
                } catch (error) {
                    console.error('Error saving profile image:', error);
                    return reject({ success: false, message: 'Failed to save profile image' });
                }
            }

            // 3. Update Database
            let updateQuery = 'UPDATE admin SET username = ?';
            let params = [newUsername];

            if (finalImagePath) {
                updateQuery += ', profile_image = ?';
                params.push(finalImagePath);
            }

            updateQuery += ' WHERE username = ?';
            params.push(username);

            dbModule.db.run(updateQuery, params, function (err) {
                if (err) {
                    reject({ success: false, message: err.message });
                } else {
                    let pImage = finalImagePath;
                    if (pImage && fs.existsSync(pImage)) {
                        try {
                            const ext = path.extname(pImage).slice(1);
                            const b64 = fs.readFileSync(pImage).toString('base64');
                            pImage = `data:image/${ext};base64,${b64}`;
                        } catch (e) { }
                    }
                    resolve({
                        success: true,
                        message: 'Profile updated successfully',
                        user: { username: newUsername, profile_image: pImage }
                    });
                }
            });
        });
    });
}

module.exports = registerAuthHandlers;
