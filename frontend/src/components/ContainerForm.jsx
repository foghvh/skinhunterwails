import React, { useState } from "react";
import { useNavigate } from "react-router";
import { Button, Text, Flex, Card } from "@radix-ui/themes";
import { PersonIcon, LockClosedIcon, EnvelopeClosedIcon, Cross1Icon } from "@radix-ui/react-icons";
import { toast } from "sonner";
import { Login, Register } from '../../wailsjs/go/main/App';

const ContainerForm = ({ closePopup, setCurrentPopup, currentPopup }) => {
    const [formData, setFormData] = useState({ login: "", password: "", email: "" });
    const [statusMessage, setStatusMessage] = useState("");
    const navigate = useNavigate();

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        try {
            const response = await Register(formData.email, formData.password, formData.login);
            if (response.success) {
                toast.success(response.message);
                setCurrentPopup("login");
            } else {
                toast.error(response.error || "Registration failed");
            }
            setStatusMessage(response.message);
        } catch (error) {
            console.error(error);
            toast.error("Registration failed: " + (error.message || "Unknown error"));
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        try {
            const response = await Login(formData.login, formData.password);
            if (response.success) {
                localStorage.setItem("token", response.token);
                toast.success(`Welcome back! ${response.user.login}`);
                navigate("/home");
                closePopup();
            } else {
                toast.error(response.error || "Login failed");
                setStatusMessage("Unable to log in. Please check your credentials.");
            }
        } catch (error) {
            console.error("Login error:", error);
            toast.error("Login failed: " + (error.message || "Unknown error"));
            setStatusMessage("Unable to log in. Please check your credentials.");
        }
    };
    return (
        <Card variant="ghost" style={{ padding: '24px' }}>
            <Flex justify="between" align="center">
                <Text size="5" weight="bold">{currentPopup === "register" ? "Register" : "Login"}</Text>
                <Button variant="ghost" onClick={closePopup}>
                    <Cross1Icon width="20" height="20" />
                </Button>
            </Flex>

            {currentPopup === "register" ? (
                <form onSubmit={handleRegister} style={{ marginTop: '16px' }}>
                    <Flex direction="column" gap="3">
                        <Flex align="center" gap="2">
                            <PersonIcon width="18" height="18" />
                            <Text>Login</Text>
                        </Flex>
                        <input name="login"
                            value={formData.login}
                            onChange={handleChange}
                            placeholder="Enter your login"
                            required
                            style={{ flex: 1, padding: "10px", background: 'transparent', border: 'none', color: 'white', outline: 'none', backgroundColor: 'var(--color-surface)', padding: "5px" }}>

                        </input>

                        <Flex align="center" gap="2">
                            <LockClosedIcon width="18" height="18" />
                            <Text>Password</Text>
                        </Flex>
                        <input type="password"
                            name="password"
                            value={formData.password}
                            onChange={handleChange}
                            placeholder="Enter your password"
                            required
                            style={{ flex: 1, background: 'transparent', border: 'none', color: 'white', outline: 'none', backgroundColor: 'var(--color-surface)', padding: "5px" }}>

                        </input>

                        <Flex align="center" gap="2">
                            <EnvelopeClosedIcon width="18" height="18" />
                            <Text>Email</Text>
                        </Flex>
                        <input type="email"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            placeholder="Enter your email"
                            required
                            style={{ flex: 1, background: 'transparent', border: 'none', color: 'white', outline: 'none', backgroundColor: 'var(--color-surface)', padding: "5px" }}>

                        </input>

                        <Text color="gray">{statusMessage}</Text>
                        <Text size="2">
                            Already have an account?{' '}
                            <Text as="span" color="blue" style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setCurrentPopup("login")}>
                                Login
                            </Text>
                        </Text>
                        <Button type="submit">REGISTER</Button>
                    </Flex>
                </form>
            ) : (
                <form onSubmit={handleLogin} style={{ marginTop: '16px' }}>
                    <Flex direction="column" gap="3">
                        <Flex align="center" gap="2">
                            <PersonIcon width="18" height="18" />
                            <Text>Login</Text>
                        </Flex>
                        <input name="login"
                            value={formData.login}
                            onChange={handleChange}
                            placeholder="Enter your login"
                            required
                            style={{ flex: 1, background: 'transparent', border: 'none', color: 'white', outline: 'none', backgroundColor: 'var(--color-surface)', padding: "5px" }}>

                        </input>

                        <Flex align="center" gap="2">
                            <LockClosedIcon width="18" height="18" />
                            <Text>Password</Text>
                        </Flex>
                        <input type="password"
                            name="password"
                            value={formData.password}
                            onChange={handleChange}
                            placeholder="Enter your password"
                            required
                            style={{ flex: 1, background: 'transparent', border: 'none', color: 'white', outline: 'none', backgroundColor: 'var(--color-surface)', padding: "5px" }}>

                        </input>

                        <Text color="gray">{statusMessage}</Text>
                        <Text size="2">
                            Don't have an account?{' '}
                            <Text as="span" color="blue" style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setCurrentPopup("register")}>
                                Register
                            </Text>
                        </Text>
                        <Button  type="submit">LOGIN</Button>
                    </Flex>
                </form>
            )}
        </Card>
    );
};

export default ContainerForm;