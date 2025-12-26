import React, { createContext, useContext, useEffect, useState } from 'react';
import { initFirebase, getAuthInstance } from '../firebase';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, query, where, getDocs } from 'firebase/firestore';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [currentUser, setCurrentUser] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);

    const login = (email, password) => {
        const auth = getAuthInstance();
        if (!auth) throw new Error("Firebase not initialized");
        return signInWithEmailAndPassword(auth, email, password);
    };

    const logout = () => {
        const auth = getAuthInstance();
        if (!auth) return Promise.resolve();
        return signOut(auth);
    };

    useEffect(() => {
        let unsubscribe;

        const initializeAuth = async () => {
            try {
                const { auth: authInstance, db: dbInstance } = await initFirebase();

                unsubscribe = onAuthStateChanged(authInstance, async (user) => {
                    setLoading(true);
                    if (user) {
                        try {
                            // Check if user is admin in Firestore
                            const q = query(collection(dbInstance, "users"), where("email", "==", user.email));
                            const querySnapshot = await getDocs(q);

                            let adminStatus = false;
                            querySnapshot.forEach((doc) => {
                                if (doc.data().is_admin === true) {
                                    adminStatus = true;
                                }
                            });

                            if (adminStatus) {
                                setCurrentUser(user);
                                setIsAdmin(true);
                            } else {
                                console.error("Access Denied: User is not an admin.");
                                await signOut(authInstance);
                                setCurrentUser(null);
                                setIsAdmin(false);
                                alert("Access Denied: You do not have administrator privileges.");
                            }
                        } catch (error) {
                            console.error("Error verifying admin status:", error);
                            setCurrentUser(null);
                            setIsAdmin(false);
                        }
                    } else {
                        setCurrentUser(null);
                        setIsAdmin(false);
                    }
                    setLoading(false);
                });
            } catch (error) {
                console.error("Failed to initialize auth:", error);
                setLoading(false); // Stop loading even if init fails
            }
        };

        initializeAuth();

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, []);

    const value = {
        currentUser,
        isAdmin,
        login,
        logout,
        loading
    };

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
};
