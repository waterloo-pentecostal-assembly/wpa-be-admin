import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from '../firebase';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, query, where, getDocs } from 'firebase/firestore';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [currentUser, setCurrentUser] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);

    const login = (email, password) => {
        return signInWithEmailAndPassword(auth, email, password);
    };

    const logout = () => {
        return signOut(auth);
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            setLoading(true);
            if (user) {
                try {
                    // Check if user is admin in Firestore
                    const q = query(collection(db, "users"), where("email", "==", user.email));
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
                        await signOut(auth);
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

        return unsubscribe;
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
